/**
 * ZipRecruiter scan: click job cards in the left panel; extract job description from right pane;
 * then click Apply in the right pane so a new tab opens with the real jobsite URL. We use that
 * URL (reject LinkedIn, Lever, or unreachable). Skips "1-Click Apply" jobs.
 * Uses persistent context (logged-in). Max jobs per run: ZIPRECRUITER_MAX_JOBS_PER_RUN (default 2).
 * Run: npm run ziprecruiter:scan
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";

import { findDuplicateJob } from "../lib/jobDuplicateDetection";
import { upsertJobApplication } from "../lib/jobApplications";
import { prisma } from "../lib/prisma";

const DEFAULT_ZIPRECRUITER_URL =
  "https://www.ziprecruiter.com/jobs-search?search=Machine+Learning+Engineer&location=Remote+%28USA%29&days=5&page=1";
const ZIPRECRUITER_SEARCH_URL =
  process.env.ZIPRECRUITER_SEARCH_URL || DEFAULT_ZIPRECRUITER_URL;
const MAX_JOBS_PER_RUN = Number(process.env.ZIPRECRUITER_MAX_JOBS_PER_RUN ?? 2);
const USER_ID = Number(process.env.JOBBOT_USER_ID ?? 1);

/** Log a step and return a function that logs elapsed ms when called. */
function logTimed(label: string): () => void {
  const start = Date.now();
  return () => {
    const ms = Date.now() - start;
    console.log(`     ⏱️ ${label}: ${ms} ms`);
  };
}

function expandPath(dir: string | undefined): string {
  const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
  if (!dir) return path.join(home, ".jobbot", "ziprecruiter");
  const cleanPath = dir.split(/\s+/)[0].trim().replace(/^["']|["']$/g, "");
  return cleanPath.replace(/\$HOME|^~/, home);
}

const PERSISTENT_CONTEXT_DIR = expandPath(process.env.ZIPRECRUITER_CONTEXT_DIR);

function findChromeExecutable(): string | undefined {
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
      const dom = String(c.domain || c.host || c.hostKey || ".ziprecruiter.com").trim();
      const domain = c.hostOnly ? dom : dom.startsWith(".") ? dom : dom ? `.${dom}` : ".ziprecruiter.com";
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

/** Reject EEO/voluntary disclosure text (same logic as Jobright). */
function looksLikeEeoOrApplicationForm(text: string): boolean {
  const lower = text.toLowerCase();
  const eeoMarkers = [
    "eeo",
    "equal employment",
    "voluntary self",
    "race/ethnicity",
    "disability status",
    "veteran status",
    "government id",
    "i identify as",
    "please select",
    "decline to",
  ];
  let matchCount = 0;
  for (const m of eeoMarkers) if (lower.includes(m)) matchCount++;
  if (matchCount >= 2) return true;
  if (lower.includes("disability status") && lower.includes("please select")) return true;
  return false;
}

/** Wait for job description content to appear in the right panel (often loaded after pane is visible). */
async function waitForJobDescriptionContent(page: any): Promise<void> {
  const container = page.locator("[data-testid='job-details-scroll-container'], [data-testid='right-pane']").first();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const text = (await container.innerText().catch(() => ""))?.trim() || "";
    if (text.length >= 100) return;
    if (text.includes("Job description") && text.length >= 50) return;
    await page.waitForTimeout(400);
  }
}

/** Extract job description from the right panel. Structure: scroll-container has h2 "Job description" then a div with the body (e.g. whitespace-pre-line). */
async function extractJobDescriptionFromRightPanel(page: any): Promise<string> {
  await waitForJobDescriptionContent(page);

  // Prefer the description body block: h2 "Job description" then div with text-primary + whitespace-pre-line (and often wrap-anywhere)
  const descriptionBodySelectors = [
    "[data-testid='job-details-scroll-container'] div[class*='whitespace-pre-line'][class*='text-primary']",
    "[data-testid='right-pane'] div[class*='whitespace-pre-line'][class*='text-primary']",
    "[data-testid='job-details-scroll-container'] div[class*='whitespace-pre-line']",
    "[data-testid='right-pane'] div[class*='whitespace-pre-line']",
    "[data-testid='job-details-scroll-container'] div[class*='wrap-anywhere'][class*='whitespace-pre-line']",
    "[data-testid='right-pane'] div[class*='wrap-anywhere'][class*='whitespace-pre-line']",
    "[data-testid='job-details-scroll-container'] div[class*='text-primary']",
    "[data-testid='right-pane'] div[class*='text-primary']",
  ];
  for (const sel of descriptionBodySelectors) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) === 0) continue;
      const text = (await el.innerText().catch(() => ""))?.trim() || "";
      if (text.length < 50) continue;
      if (looksLikeEeoOrApplicationForm(text)) continue;
      return text;
    } catch {
      continue;
    }
  }

  // Fallback: full scroll container or right pane
  const rightPanelSelectors = [
    "[data-testid='job-details-scroll-container']",
    "[data-testid='right-pane'] [data-testid='job-details-scroll-container']",
    "[data-testid='right-pane']",
  ];
  for (const sel of rightPanelSelectors) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) === 0) continue;
      const text = (await el.innerText().catch(() => ""))?.trim() || "";
      if (text.length < 50) continue;
      if (looksLikeEeoOrApplicationForm(text)) continue;
      return text;
    } catch {
      continue;
    }
  }
  return "";
}

/** Left-pane pagination. ZipRecruiter uses an <a title="Next Page"> with href like /jobs-search/2?..., not a button. */
const PAGINATION_NEXT_SELECTORS = [
  "a[title='Next Page']",
  "div.pagination_container_two_pane a[title='Next Page']",
  "div.pagination_container_two_pane button[title='Next Page']",
  "button[title='Next Page']",
  "button[aria-label='Next Page']",
  "[aria-label='Next Page']",
  "a[aria-label*='Next']",
  "nav a:has-text('Next')",
  "nav button:has-text('Next')",
  ".pagination_container_two_pane button:has-text('Next')",
  "button:has-text('Next')",
  "a[href*='/jobs-search/']:has-text('Next')",
];

/** Get next page URL. ZipRecruiter uses path /jobs-search/1, /jobs-search/2; fallback to ?page=N. */
function getNextPageUrl(currentUrl: string): string | null {
  try {
    const u = new URL(currentUrl);
    const path = u.pathname;
    // Path-based: /jobs-search/1 or /jobs-search/2 etc.
    const pathMatch = path.match(/^(\/jobs-search)\/(\d+)\/?$/);
    if (pathMatch) {
      const num = parseInt(pathMatch[2], 10);
      if (Number.isFinite(num) && num >= 1) {
        u.pathname = `${pathMatch[1]}/${num + 1}`;
        return u.toString();
      }
    }
    // Path without number: /jobs-search -> /jobs-search/2
    if (path.replace(/\/$/, "") === "/jobs-search") {
      u.pathname = "/jobs-search/2";
      return u.toString();
    }
    // Query-based fallback: ?page=1 -> ?page=2
    const p = u.searchParams.get("page");
    const num = p ? parseInt(p, 10) : 1;
    if (Number.isFinite(num) && num >= 1) {
      u.searchParams.set("page", String(num + 1));
      return u.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/** Right-pane Apply button selectors (ZipRecruiter). */
const APPLY_BUTTON_SELECTORS = [
  "[data-testid='right-pane'] a:has-text('Apply')",
  "[data-testid='right-pane'] button:has-text('Apply')",
  "[data-testid='job-details-scroll-container'] a:has-text('Apply')",
  "[data-testid='job-details-scroll-container'] button:has-text('Apply')",
  "[data-testid='right-pane'] >> a[href]:has-text('Apply')",
  "a:has-text('Apply Now')",
  "button:has-text('Apply Now')",
];

/**
 * Click Apply in the right pane, wait for new tab to open and load, then return the real jobsite URL.
 * Rejects LinkedIn, Lever, ZipRecruiter (no external), and empty/unreachable.
 * Caller must close the new tab and bring ZipRecruiter page back to front when done.
 */
async function clickApplyAndGetRealJobUrl(
  page: any,
  context: any
): Promise<{ url: string; newPage: any } | null> {
  const rightPane = page.locator("[data-testid='right-pane'], [data-testid='job-details-scroll-container']").first();
  let applyEl = null;
  for (const sel of APPLY_BUTTON_SELECTORS) {
    const el = rightPane.locator(sel).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
      applyEl = el;
      break;
    }
  }
  if (!applyEl) {
    const inPage = page.locator("a:has-text('Apply'), button:has-text('Apply')").first();
    if ((await inPage.count()) > 0 && (await inPage.isVisible().catch(() => false))) applyEl = inPage;
  }
  if (!applyEl) {
    console.log("  ⚠️ Apply button not found in right pane");
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
    console.log("  ⚠️ No new tab opened after Apply click");
    return null;
  }

  // Capture main document response status (so we can reject 403 Forbidden)
  let mainDocStatus: number | null = null;
  newPage.on("response", (response: any) => {
    if (response.request().resourceType() === "document") {
      mainDocStatus = response.status();
    }
  });

  // New tab may open on ZipRecruiter or about:blank then redirect to company site. Wait for URL to settle.
  const waitForCompanyUrlMs = 25000;
  const pollIntervalMs = 1500;
  let url = newPage.url().trim();
  const startWait = Date.now();
  while (Date.now() - startWait < waitForCompanyUrlMs) {
    url = newPage.url().trim();
    const isBlank = !url || url === "about:blank" || url.startsWith("about:");
    const isZipRecruiter = url.toLowerCase().includes("ziprecruiter.com");
    if (!isBlank && !isZipRecruiter) {
      break;
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  url = newPage.url().trim();

  // Wait for the company page to finish loading
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
    console.log("  ⏭️ Skip: no valid URL (about:blank or empty)");
    await newPage.close().catch(() => {});
    return null;
  }
  if (url.toLowerCase().includes("ziprecruiter.com")) {
    console.log("  ⏭️ Skip: Apply did not leave ZipRecruiter (waited for company URL)");
    await newPage.close().catch(() => {});
    return null;
  }
  if (mainDocStatus === 403) {
    console.log("  ⏭️ Skip: 403 Forbidden (company site blocked access)");
    await newPage.close().catch(() => {});
    return null;
  }
  if (url.toLowerCase().includes("linkedin.com")) {
    console.log("  ⏭️ Skip: LinkedIn URL (rejected)");
    await newPage.close().catch(() => {});
    return null;
  }
  if (url.toLowerCase().includes("lever.co") || url.toLowerCase().includes("jobs.lever.co")) {
    console.log("  ⏭️ Skip: Lever URL (rejected)");
    await newPage.close().catch(() => {});
    return null;
  }

  return { url, newPage };
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

async function main() {
  console.log("\n🔍 ZipRecruiter Scanner\n");
  console.log(`Max jobs per run: ${MAX_JOBS_PER_RUN} (set ZIPRECRUITER_MAX_JOBS_PER_RUN in .env)`);
  console.log(`Search URL: ${ZIPRECRUITER_SEARCH_URL}`);
  console.log("(Detailed timing is logged below so you can see where time is spent.)\n");

  const actualUserId = await ensureUserExists(USER_ID);

  if (!fs.existsSync(PERSISTENT_CONTEXT_DIR)) {
    console.error("❌ Context directory not found. Run: npm run ziprecruiter:init");
    process.exit(1);
  }

  const cookiesFile =
    process.env.ZIPRECRUITER_COOKIES_FILE ||
    path.join(path.dirname(PERSISTENT_CONTEXT_DIR), "ziprecruiter-cookies.json");
  if (!fs.existsSync(cookiesFile)) {
    console.warn("⚠️ No cookie file. Run nodriver or init first: npm run ziprecruiter:nodriver");
  }

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error("❌ Chrome not found. Set ZIPRECRUITER_CHROME_PATH.");
    process.exit(1);
  }

  chromium.use(StealthPlugin());

  let done = logTimed("launch browser (persistent context)");
  const context = await chromium.launchPersistentContext(PERSISTENT_CONTEXT_DIR, {
    executablePath: chromePath,
    headless: false,
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });
  done();

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

  done = logTimed("page.goto (domcontentloaded)");
  await page.goto(ZIPRECRUITER_SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  done();

  if (await isCloudflareChallenge(page)) {
    console.log("⚠️ Complete Cloudflare verification in the browser, then press ENTER.");
    await new Promise<void>((r) => process.stdin.once("data", () => r()));
  }

  done = logTimed("wait for first job card visible");
  await page.locator("div.job_result_two_pane_v2").first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  done();

  // Left panel: job cards (div.job_result_two_pane_v2); click card to load right pane with job description
  done = logTimed("find card selector + query all cards");
  const leftPanelCardSelectors = [
    "div.job_result_two_pane_v2",
    "[data-testid='left-pane'] [data-testid*='job-card']",
    "[data-testid='left-pane'] article",
    "[data-testid='left-pane'] >> li",
    "[data-testid*='job-card']",
    "[data-testid='left-pane'] >> a[href*='ziprecruiter']",
    "article[data-testid*='job']",
    "article",
  ];

  let usedCardSelector = "";
  for (const sel of leftPanelCardSelectors) {
    const list = await page.locator(sel).all();
    if (list.length >= 1) {
      usedCardSelector = sel;
      console.log(`Found ${list.length} job cards in left panel (selector: ${sel})`);
      console.log("Cards do not disappear after scan; we track card index so we don't re-scan the same one.\n");
      break;
    }
  }
  done();

  if (!usedCardSelector) {
    console.log("No job cards found. Check selectors or run: npm run explore:ziprecruiter");
    await context.close();
    process.exit(0);
  }

  let processed = 0;
  let cardIndex = 0;
  const scanStart = Date.now();
  /** First card (title||company) on current page—used to detect when URL pagination returns the same page. */
  let firstCardSignature: string | null = null;

  while (processed < MAX_JOBS_PER_RUN) {
    const cardLoopStart = Date.now();
    console.log(`\n  --- Card #${cardIndex + 1} (index ${cardIndex}) ---`);

    let step = logTimed("re-query card list (DOM)");
    const cards = await page.locator(usedCardSelector).all();
    step();
    if (cardIndex >= cards.length) {
      // Remember first card on this page so we can detect "same page" after URL nav
      let signatureBeforeNav: string | null = null;
      if (cards.length > 0) {
        const c0 = cards[0];
        const t0 = (await c0.locator("h2, h3, [class*='title']").first().innerText().catch(() => ""))?.trim() || "";
        const co0 = (await c0.locator("[data-testid='job-card-company'], [class*='company']").first().innerText().catch(() => ""))?.trim() || "";
        signatureBeforeNav = `${t0}|||${co0}`;
      }

      // Try to go to next page: first by clicking Next button, then by URL.
      let nextClicked = false;
      for (const sel of PAGINATION_NEXT_SELECTORS) {
        const nextBtn = page.locator(sel).first();
        if ((await nextBtn.count()) === 0) continue;
        const disabled = await nextBtn.getAttribute("disabled").catch(() => null);
        if (disabled != null) break;
        const visible = await nextBtn.isVisible().catch(() => false);
        if (!visible) continue;
        console.log(`  📄 No more cards on this page; clicking Next Page...`);
        step = logTimed("click Next Page + wait for new cards");
        await nextBtn.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2000);
        await page.locator(usedCardSelector).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
        step();
        cardIndex = 0;
        firstCardSignature = null; // reset so we don't think next page is "same"
        nextClicked = true;
        break;
      }
      // Fallback: paginate by URL (e.g. page=1 -> page=2)
      if (!nextClicked) {
        const currentUrl = page.url();
        const nextUrl = getNextPageUrl(currentUrl);
        if (nextUrl && nextUrl !== currentUrl) {
          console.log(`  📄 No Next button found; navigating to next page via URL (page=N+1)...`);
          console.log(`     URL: ${nextUrl}`);
          step = logTimed("goto next page URL + wait for cards");
          await page.goto(nextUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
          const urlAfter = page.url();
          console.log(`     After load: ${urlAfter}`);
          await page.waitForTimeout(2000);
          await page.locator(usedCardSelector).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
          step();
          const newCards = await page.locator(usedCardSelector).all();
          if (newCards.length > 0) {
            const c0 = newCards[0];
            const t0 = (await c0.locator("h2, h3, [class*='title']").first().innerText().catch(() => ""))?.trim() || "";
            const co0 = (await c0.locator("[data-testid='job-card-company'], [class*='company']").first().innerText().catch(() => ""))?.trim() || "";
            const newFirstSignature = `${t0}|||${co0}`;
            if (signatureBeforeNav != null && newFirstSignature === signatureBeforeNav) {
              console.log(`  ⚠️ Same page loaded again (first card unchanged). ZipRecruiter may ignore \`page\` param. Stopping pagination.`);
              break;
            }
            cardIndex = 0;
            firstCardSignature = newFirstSignature;
            nextClicked = true;
          }
        }
      }
      if (!nextClicked) {
        console.log(`No more cards and no Next Page (or Next disabled). Done.`);
        break;
      }
      continue;
    }

    const card = cards[cardIndex];
    try {
      // Title and company are in the job card (left pane). Company: data-testid="job-card-company"
      step = logTimed("read title + company from card");
      const withinCard = card.locator("article").first();
      const title =
        (await withinCard.locator("h2, h3, [class*='title']").first().innerText().catch(() => ""))?.trim() ||
        (await card.locator("h2, h3, [class*='title']").first().innerText().catch(() => ""))?.trim() ||
        "Unknown";
      const company =
        (await card.locator("[data-testid='job-card-company']").first().innerText().catch(() => ""))?.trim() ||
        (await withinCard.locator("[class*='company'], [class*='Company']").first().innerText().catch(() => ""))?.trim() ||
        (await card.locator("[class*='company'], [class*='Company']").first().innerText().catch(() => ""))?.trim() ||
        "Unknown";
      step();

      console.log(`  📄 ${title} @ ${company}`);

      step = logTimed("click card + wait for right pane visible (+ 400ms buffer)");
      await card.click();
      const rightPane = page.locator("[data-testid='job-details-scroll-container'], [data-testid='right-pane']").first();
      await rightPane.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(400);
      step();

      step = logTimed("get right panel text (1-Click check)");
      const rightPanelText = (await page.locator("[data-testid='job-details-scroll-container'], [data-testid='right-pane']").first().innerText().catch(() => "")) || "";
      step();
      if (/1\s*[- ]?\s*click\s*apply/i.test(rightPanelText)) {
        console.log(`  ⏭️ Skip: 1-Click Apply (in right panel)`);
        console.log(`     ⏱️ card total: ${Date.now() - cardLoopStart} ms\n`);
        cardIndex++;
        continue;
      }

      step = logTimed("extract job description from right panel");
      const description = await extractJobDescriptionFromRightPanel(page);
      step();
      if (!description.trim()) console.log(`  ⚠️ No description extracted`);

      step = logTimed("click Apply and wait for new tab (real jobsite URL)");
      const applyResult = await clickApplyAndGetRealJobUrl(page, context);
      step();
      if (!applyResult) {
        console.log(`     ⏱️ card total: ${Date.now() - cardLoopStart} ms\n`);
        cardIndex++;
        continue;
      }
      const { url: jobUrl, newPage: applyTab } = applyResult;
      console.log(`  🔗 Real jobsite URL: ${jobUrl}`);

      step = logTimed("duplicate check (normalized URL / title+company)");
      const duplicate = await findDuplicateJob({
        userId: actualUserId,
        externalUrl: jobUrl,
        title,
        company,
      });
      step();
      if (duplicate) {
        console.log(`  ⏭️ Skip: duplicate (${duplicate.reason}) – already have this job`);
        await applyTab.close().catch(() => {});
        await page.bringToFront();
        console.log(`     ⏱️ card total: ${Date.now() - cardLoopStart} ms\n`);
        cardIndex++;
        continue;
      }

      step = logTimed("upsertJobApplication (DB)");
      const saved = await upsertJobApplication({
        userId: actualUserId,
        source: "ziprecruiter",
        title,
        company,
        externalUrl: jobUrl,
      });
      step();
      step = logTimed("saveJobDescription (DB)");
      if (description.trim()) await saveJobDescription(saved.id, description.trim());
      step();

      await applyTab.close().catch(() => {});
      await page.bringToFront();
      await page.waitForTimeout(300);

      processed++;
      console.log(`  ✅ Saved real URL + description (${description.length} chars)`);
      console.log(`     ⏱️ card total: ${Date.now() - cardLoopStart} ms\n`);
      cardIndex++;
    } catch (e: any) {
      console.error(`  ❌ Error: ${e.message}`);
      console.log(`     ⏱️ card total: ${Date.now() - cardLoopStart} ms\n`);
      cardIndex++;
    }
  }

  const totalMs = Date.now() - scanStart;
  console.log(`\n✅ Done. Processed ${processed} job(s). Total scan time: ${(totalMs / 1000).toFixed(1)} s`);
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
