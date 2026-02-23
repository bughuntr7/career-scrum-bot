/**
 * Glassdoor scan: click job cards in the left list; in the right panel click "Show more"
 * to expand description, extract job description; only process jobs that have
 * "Apply on employer site" (skip Easy Apply). Click that button to get real jobsite URL.
 * Uses persistent context + cookies from nodriver. Max jobs: GLASSDOOR_MAX_JOBS_PER_RUN.
 * Run: npm run glassdoor:scan
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";

import { findDuplicateJob } from "../lib/jobDuplicateDetection";
import { upsertJobApplication } from "../lib/jobApplications";
import { prisma } from "../lib/prisma";

const DEFAULT_GLASSDOOR_URL =
  "https://www.glassdoor.com/Job/remote-machine-learning-engineer-jobs-SRCH_IL.0,6_IS11047_KO7,32.htm?fromAge=7&remoteWorkType=1";
const GLASSDOOR_SEARCH_URL = process.env.GLASSDOOR_SEARCH_URL || DEFAULT_GLASSDOOR_URL;
const MAX_JOBS_PER_RUN = Number(process.env.GLASSDOOR_MAX_JOBS_PER_RUN ?? 5);
const USER_ID = Number(process.env.JOBBOT_USER_ID ?? 1);

function expandPath(dir: string | undefined): string {
  const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
  if (!dir) return path.join(home, ".jobbot", "glassdoor");
  const cleanPath = dir.split(/\s+/)[0].trim().replace(/^["']|["']$/g, "");
  return cleanPath.replace(/\$HOME|^~/, home);
}

const PERSISTENT_CONTEXT_DIR = expandPath(process.env.GLASSDOOR_CONTEXT_DIR);

function findChromeExecutable(): string | undefined {
  if (process.env.GLASSDOOR_CHROME_PATH && fs.existsSync(process.env.GLASSDOOR_CHROME_PATH)) {
    return process.env.GLASSDOOR_CHROME_PATH;
  }
  if (process.env.ZIPRECRUITER_CHROME_PATH && fs.existsSync(process.env.ZIPRECRUITER_CHROME_PATH)) {
    return process.env.ZIPRECRUITER_CHROME_PATH;
  }
  const localAppData = process.env.LOCALAPPDATA;
  const programFiles = process.env["ProgramFiles"];
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    localAppData && path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    programFiles && path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    programFilesX86 && path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean) as string[];
  return candidates.find((p) => fs.existsSync(p));
}

type PlaywrightCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

function loadCookiesFromFile(filePath: string): PlaywrightCookie[] {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);
  const arr = Array.isArray(data) ? data : data.cookies || data || [];
  return arr
    .filter((c: any) => c.name && c.value)
    .map((c: any) => {
      const dom = String(c.domain || c.host || c.hostKey || ".glassdoor.com").trim();
      const domain = c.hostOnly ? dom : dom.startsWith(".") ? dom : dom ? `.${dom}` : ".glassdoor.com";
      const expires = c.expirationDate != null ? Math.floor(Number(c.expirationDate)) : undefined;
      const sameSite = c.sameSite === "no_restriction" ? "None" : c.sameSite === "lax" ? "Lax" : c.sameSite === "strict" ? "Strict" : undefined;
      return {
        name: String(c.name),
        value: String(c.value),
        domain,
        path: String(c.path || c.pathKey || "/"),
        ...(expires && expires > 0 && { expires }),
        ...(c.httpOnly != null && { httpOnly: !!c.httpOnly }),
        ...(c.secure != null && { secure: !!c.secure }),
        ...(sameSite && { sameSite: sameSite as "Strict" | "Lax" | "None" }),
      };
    });
}

async function isCloudflareChallenge(page: any): Promise<boolean> {
  try {
    const hasVerify = await page.locator("text=Verify you are human").count() > 0;
    const hasSecurity = await page.locator("text=Performing security verification").count() > 0;
    return !!(hasVerify || hasSecurity);
  } catch {
    return false;
  }
}

/** Click "Show more" in the job detail panel so full description is visible, then extract from JobDetails_jobDescription container. */
async function expandAndExtractJobDescription(page: any): Promise<string> {
  const showMore = page.locator("[data-test='show-more-cta']").first();
  if ((await showMore.count()) > 0) {
    const expanded = await showMore.getAttribute("aria-expanded").catch(() => null);
    if (expanded === "false") {
      await showMore.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
    }
  }
  const descSelectors = [
    "[class*='JobDetails_jobDescription']",
    "[class*='jobDescription']",
  ];
  for (const sel of descSelectors) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) === 0) continue;
      const text = (await el.innerText().catch(() => ""))?.trim() || "";
      if (text.length >= 80) return text;
    } catch {
      continue;
    }
  }
  return "";
}

async function ensureUserExists(userId: number): Promise<number> {
  let user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: { email: "user@jobbot.local", passwordHash: "dummy" },
    });
  }
  return user.id;
}

async function saveJobDescription(jobApplicationId: number, description: string) {
  await prisma.jobDescription.upsert({
    where: { jobApplicationId },
    create: { jobApplicationId, fullText: description, source: "company_site" },
    update: { fullText: description },
  });
}

/** Left pane: job card selectors. Card has data-test="job-title" (title) and EmployerProfile_compactEmployerName (company). */
const JOB_CARD_SELECTORS = [
  "[data-test='job-card-wrapper']",
  "li[data-test='jobListing']",
  "[data-test='job-card']",
  "li[class*='JobCard']",
  "ul[class*='JobsList'] > li",
  "article[class*='job']",
];

/** Only process jobs that have "Apply on employer site"; skip Easy-Apply-only. */
function hasApplyOnEmployerSite(page: any): Promise<boolean> {
  return page.locator("a:has-text('Apply on employer site'), button:has-text('Apply on employer site')").first().isVisible().catch(() => false);
}

/** Dismiss sign-in/auth dialog (#unified-user-auth) so it doesn't block clicks on job cards. */
async function dismissGlassdoorAuthDialog(page: any): Promise<void> {
  const dialog = page.locator("#unified-user-auth dialog[open], dialog[data-is-bottom-sheet='true'][open]").first();
  if ((await dialog.count()) === 0) return;
  if (!(await dialog.isVisible().catch(() => false))) return;
  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  } catch {
    // ignore
  }
  const stillOpen = await dialog.isVisible().catch(() => false);
  if (!stillOpen) return;
  const closeSelectors = [
    "[aria-label='Close']",
    "button:has-text('Close')",
    "button:has-text('Maybe later')",
    "a:has-text('Maybe later')",
    "button:has-text('Skip')",
    "a:has-text('Skip')",
    "button:has-text('No thanks')",
    "[data-test='modal-close']",
    "button[class*='close']",
  ];
  for (const sel of closeSelectors) {
    const btn = dialog.locator(sel).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }
  }
}

/**
 * Click "Apply on employer site", wait for new tab, return real jobsite URL or null.
 */
async function clickApplyOnEmployerSiteAndGetUrl(page: any, context: any): Promise<{ url: string; newPage: any } | null> {
  const applyEl = page.locator("a:has-text('Apply on employer site'), button:has-text('Apply on employer site')").first();
  if ((await applyEl.count()) === 0 || !(await applyEl.isVisible().catch(() => false))) {
    console.log("  ⚠️ Apply on employer site button not found");
    return null;
  }
  const pagesBefore = context.pages();
  const pagePromise = context.waitForEvent("page", { timeout: 20000 }).catch(() => null);
  await applyEl.click({ timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(2500);

  let newPage = await pagePromise;
  if (!newPage) {
    const pagesAfter = context.pages();
    const added = pagesAfter.filter((p: any) => !pagesBefore.includes(p));
    if (added.length > 0) newPage = added[0];
  }
  if (!newPage) {
    console.log("  ⚠️ No new tab opened");
    return null;
  }

  let mainDocStatus: number | null = null;
  newPage.on("response", (response: any) => {
    if (response.request().resourceType() === "document") {
      mainDocStatus = response.status();
    }
  });

  const waitForCompanyUrlMs = 25000;
  const pollIntervalMs = 1500;
  let url = newPage.url().trim();
  const startWait = Date.now();
  while (Date.now() - startWait < waitForCompanyUrlMs) {
    url = newPage.url().trim();
    const isBlank = !url || url === "about:blank" || url.startsWith("about:");
    const isGlassdoor = url.toLowerCase().includes("glassdoor.com");
    if (!isBlank && !isGlassdoor) break;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  url = newPage.url().trim();

  try {
    await newPage.waitForLoadState("load", { timeout: 20000 }).catch(() =>
      newPage.waitForLoadState("domcontentloaded", { timeout: 10000 })
    );
    await newPage.waitForTimeout(500);
  } catch {
    // use URL we have
  }
  url = newPage.url().trim();

  if (!url || url === "about:blank" || url.startsWith("about:")) {
    console.log("  ⏭️ Skip: no valid URL");
    await newPage.close().catch(() => {});
    return null;
  }
  if (url.toLowerCase().includes("glassdoor.com")) {
    console.log("  ⏭️ Skip: did not leave Glassdoor");
    await newPage.close().catch(() => {});
    return null;
  }
  if (mainDocStatus === 403) {
    console.log("  ⏭️ Skip: 403 Forbidden");
    await newPage.close().catch(() => {});
    return null;
  }
  if (url.toLowerCase().includes("linkedin.com")) {
    console.log("  ⏭️ Skip: LinkedIn (rejected)");
    await newPage.close().catch(() => {});
    return null;
  }
  if (url.toLowerCase().includes("lever.co") || url.toLowerCase().includes("jobs.lever.co")) {
    console.log("  ⏭️ Skip: Lever (rejected)");
    await newPage.close().catch(() => {});
    return null;
  }

  return { url, newPage };
}

async function main() {
  console.log("\n🔍 Glassdoor Scanner\n");
  console.log(`Max jobs per run: ${MAX_JOBS_PER_RUN} (GLASSDOOR_MAX_JOBS_PER_RUN)`);
  console.log(`Search URL: ${GLASSDOOR_SEARCH_URL}\n`);

  const actualUserId = await ensureUserExists(USER_ID);

  if (!fs.existsSync(PERSISTENT_CONTEXT_DIR)) {
    console.error("❌ Context directory not found. Run: npm run glassdoor:init");
    process.exit(1);
  }

  const cookiesFile =
    process.env.GLASSDOOR_COOKIES_FILE || path.join(path.dirname(PERSISTENT_CONTEXT_DIR), "glassdoor-cookies.json");
  if (!fs.existsSync(cookiesFile)) {
    console.warn("⚠️ No cookie file. Run: python scripts/glassdoor_nodriver.py then npm run glassdoor:init");
  }

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error("❌ Chrome not found. Set GLASSDOOR_CHROME_PATH or ZIPRECRUITER_CHROME_PATH.");
    process.exit(1);
  }

  chromium.use(StealthPlugin());

  const context = await chromium.launchPersistentContext(PERSISTENT_CONTEXT_DIR, {
    executablePath: chromePath,
    headless: false,
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage", "--no-sandbox"],
  });

  const page = context.pages()[0] || (await context.newPage());
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    if (!(window as any).chrome) (window as any).chrome = { runtime: {} };
  });

  if (fs.existsSync(cookiesFile)) {
    const cookies = loadCookiesFromFile(cookiesFile);
    await context.addCookies(cookies);
    console.log(`Loaded ${cookies.length} cookies.\n`);
  }

  await page.goto(GLASSDOOR_SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  if (await isCloudflareChallenge(page)) {
    console.log("⚠️ Complete Cloudflare verification in the browser, then press ENTER.");
    await new Promise<void>((r) => process.stdin.once("data", () => r()));
  }

  await page.waitForTimeout(3000);

  let usedCardSelector = "";
  for (const sel of JOB_CARD_SELECTORS) {
    const list = await page.locator(sel).all();
    if (list.length >= 1) {
      usedCardSelector = sel;
      console.log(`Found ${list.length} job cards (selector: ${sel})\n`);
      break;
    }
  }

  if (!usedCardSelector) {
    console.log("No job cards found. Check selectors or run glassdoor:init and ensure the search page loads.");
    await context.close();
    process.exit(0);
  }

  let processed = 0;
  let cardIndex = 0;

  while (processed < MAX_JOBS_PER_RUN) {
    const cards = await page.locator(usedCardSelector).all();
    if (cardIndex >= cards.length) {
      console.log(`\nNo more cards (index ${cardIndex}, ${cards.length} visible).`);
      break;
    }

    const card = cards[cardIndex];
    try {
      // Title and company from the job card (left pane): data-test="job-title" and EmployerProfile_compactEmployerName
      const title =
        (await card.locator("[data-test='job-title']").first().innerText().catch(() => ""))?.trim() ||
        (await page.locator("[data-test='job-title']").first().innerText().catch(() => ""))?.trim() ||
        "Unknown";
      const company =
        (await card.locator("span[class*='EmployerProfile_compactEmployerName'], [class*='compactEmployerName']").first().innerText().catch(() => ""))?.trim() ||
        (await page.locator("[data-test='job-employer-name'], [class*='Employer']").first().innerText().catch(() => ""))?.trim() ||
        "Unknown";
      console.log(`  📄 Card #${cardIndex + 1} – ${title} @ ${company}`);

      const hasEasyApplyTag =
        (await card.locator("[aria-label='Easy Apply'], [class*='JobCard_easyApplyTag']").count()) > 0;
      if (hasEasyApplyTag) {
        console.log(`  ⏭️ Skip: Easy Apply (tag on card)`);
        cardIndex++;
        continue;
      }

      await dismissGlassdoorAuthDialog(page);
      try {
        await card.click({ timeout: 15000 });
      } catch {
        await dismissGlassdoorAuthDialog(page);
        await page.waitForTimeout(500);
        try {
          await card.click({ timeout: 15000 });
          clicked = true;
        } catch {
          console.log(`  ⏭️ Skip: could not click card (dialog may be blocking; close it manually and re-run)`);
          cardIndex++;
          continue;
        }
      }
      await page.waitForTimeout(2000);

      const hasEmployerApply = await hasApplyOnEmployerSite(page);
      if (!hasEmployerApply) {
        console.log(`  ⏭️ Skip: Easy Apply only (no "Apply on employer site")`);
        cardIndex++;
        continue;
      }

      const description = await expandAndExtractJobDescription(page);
      if (!description.trim()) console.log(`  ⚠️ No description extracted`);

      const applyResult = await clickApplyOnEmployerSiteAndGetUrl(page, context);
      if (!applyResult) {
        cardIndex++;
        continue;
      }
      const { url: jobUrl, newPage: applyTab } = applyResult;
      console.log(`  🔗 Real jobsite URL: ${jobUrl}`);

      const duplicate = await findDuplicateJob({
        userId: actualUserId,
        externalUrl: jobUrl,
        title,
        company,
      });
      if (duplicate) {
        console.log(`  ⏭️ Skip: duplicate (${duplicate.reason})`);
        await applyTab.close().catch(() => {});
        await page.bringToFront();
        cardIndex++;
        continue;
      }

      const saved = await upsertJobApplication({
        userId: actualUserId,
        source: "glassdoor",
        title,
        company,
        externalUrl: jobUrl,
      });
      if (description.trim()) await saveJobDescription(saved.id, description.trim());
      processed++;
      console.log(`  ✅ Saved (${description.length} chars description)\n`);
      await applyTab.close().catch(() => {});
      await page.bringToFront();
      await page.waitForTimeout(500);
      cardIndex++;
    } catch (e: any) {
      console.error(`  ❌ Error: ${e.message}`);
      cardIndex++;
    }
  }

  console.log(`\n✅ Done. Processed ${processed} job(s).`);
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
