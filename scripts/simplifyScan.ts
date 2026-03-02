/**
 * Simplify Jobs scan:
 * - Opens Simplify jobs search URL (e.g. ML engineer, Remote USA, min salary).
 * - Job list: links that include jobId= in href (left pane). Clicks each to load right pane.
 * - Right pane: company from section#company-{id} > p.text-lg.font-bold, external URL from
 *   "Website" link (utm_source=Simplify), description from p.text-sm.text-secondary-400.
 * - Uses persistent context (run simplify:init first to log in).
 *
 * Run: npm run simplify:init  (once, to log in), then: npm run simplify:scan
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";

import { findDuplicateJob } from "../lib/jobDuplicateDetection";
import { upsertJobApplication } from "../lib/jobApplications";
import { prisma } from "../lib/prisma";

const DEFAULT_SIMPLIFY_URL =
  "https://simplify.jobs/jobs?query=Machine%20learning%20engineer&state=Remote%20in%20USA&experience=Internship%3BExpert%20or%20higher%3BSenior&mostRecent=true&excludeApplied=true&minSalary=100000&jobId=e562327a-8832-4d23-a440-e3112d7a63b0&jobType=Internship%3BFull-Time&workArrangement=Remote";

const SIMPLIFY_SEARCH_URL = process.env.SIMPLIFY_SEARCH_URL || DEFAULT_SIMPLIFY_URL;
const MAX_JOBS_PER_RUN = Number(process.env.SIMPLIFY_MAX_JOBS_PER_RUN ?? 5);
const USER_ID = Number(process.env.JOBBOT_USER_ID ?? 1);

function expandPath(dir: string | undefined): string {
  const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
  if (!dir) return path.join(home, ".jobbot", "simplify");
  const cleanPath = dir.split(/\s+/)[0].trim().replace(/^["']|["']$/g, "");
  return cleanPath.replace(/\$HOME|^~/, home);
}

const PERSISTENT_CONTEXT_DIR = expandPath(process.env.SIMPLIFY_CONTEXT_DIR);

function findChromeExecutable(): string | undefined {
  if (process.env.SIMPLIFY_CHROME_PATH && fs.existsSync(process.env.SIMPLIFY_CHROME_PATH)) {
    return process.env.SIMPLIFY_CHROME_PATH;
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
    create: { jobApplicationId, fullText: description, source: "simplify" },
    update: { fullText: description },
  });
}

/** Normalize company site URL: remove utm params and trailing slash for consistency. */
function normalizeCompanyUrl(href: string): string {
  try {
    const u = new URL(href);
    u.searchParams.delete("utm_source");
    u.searchParams.delete("utm_medium");
    u.searchParams.delete("utm_campaign");
    return u.toString().replace(/\/$/, "");
  } catch {
    return href;
  }
}

/** Hostnames for job boards / aggregators we generally want to skip as primary apply URLs. */
const IGNORED_JOB_BOARD_HOSTS = [
  "linkedin.com",
  "indeed.com",
  "lever.co",
  "greenhouse.io",
  "jobs.lever.co",
  "boards.greenhouse.io",
  "myworkdayjobs.com",
  "workday.com",
  "applytojob.com",
  "smartrecruiters.com",
  "icims.com",
  "jobvite.com",
  "taleo.net",
  "ultipro.com",
];

function isIgnoredJobBoardUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return IGNORED_JOB_BOARD_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

const MAX_SCROLL_ROUNDS_NO_NEW = 8;
const SCROLL_WAIT_MS = 800;

/** Extract jobId from a card (e.g. from a[href*="jobId="]) so we can skip already-processed jobs when list recycles. */
async function getJobIdFromCard(
  card: import("playwright").Locator,
): Promise<string | null> {
  const href = await card.locator('a[href*="jobId="]').first().getAttribute("href").catch(() => null);
  if (!href) return null;
  try {
    const u = new URL(href, "https://simplify.jobs");
    return u.searchParams.get("jobId") || null;
  } catch {
    return null;
  }
}

/** Scroll the job list container down to load more cards (virtualized list). */
async function scrollJobList(page: import("playwright").Page): Promise<void> {
  await page.evaluate(() => {
    const card = document.querySelector('[data-testid="job-card"]');
    if (!card) return;
    const container =
      card.closest('div[style*="overflow"]') ||
      card.closest('div[class*="overflow-y-auto"]') ||
      card.closest('div[class*="overflow-auto"]') ||
      card.closest('[class*="scroll"]') ||
      (card.parentElement?.parentElement as HTMLElement);
    if (container && "scrollTop" in container) {
      const el = container as HTMLElement;
      el.scrollTop += 400;
    }
  });
}

/** Dismiss Simplify modal (e.g. "Did you apply?") so it doesn't block clicking job cards. */
async function dismissSimplifyModal(page: import("playwright").Page): Promise<void> {
  const overlay = page.locator('[data-testid="modal-overlay"]').first();
  if ((await overlay.count()) === 0) return;
  try {
    const yesBtn = page.getByRole("button", { name: /^Yes$/i }).first();
    if ((await yesBtn.count()) > 0) {
      await yesBtn.click({ timeout: 3000 });
      await page.waitForTimeout(300);
      return;
    }
  } catch {
    // try overlay or Escape
  }
  try {
    await overlay.click({ position: { x: 5, y: 5 }, timeout: 2000 });
  } catch {
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(200);
}

async function main() {
  console.log("\n🔍 Simplify Jobs Scanner\n");
  console.log(`Max jobs per run: ${MAX_JOBS_PER_RUN} (SIMPLIFY_MAX_JOBS_PER_RUN)`);
  console.log(`Search URL: ${SIMPLIFY_SEARCH_URL}`);
  console.log(`Using persistent context: ${PERSISTENT_CONTEXT_DIR}`);
  if (!fs.existsSync(PERSISTENT_CONTEXT_DIR)) {
    console.error("\n⚠️  No Simplify session found. Run first: npm run simplify:init (log in), then run this again.\n");
    process.exit(1);
  }
  console.log("");

  const actualUserId = await ensureUserExists(USER_ID);

  chromium.use(StealthPlugin());

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error("❌ Google Chrome not found. Set SIMPLIFY_CHROME_PATH or ZIPRECRUITER_CHROME_PATH.");
    process.exit(1);
  }

  const context = await chromium.launchPersistentContext(PERSISTENT_CONTEXT_DIR, {
    executablePath: chromePath,
    headless: false,
    viewport: { width: 1400, height: 900 },
    locale: "en-US",
    args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage", "--no-sandbox"],
  });

  const page = context.pages()[0] || (await context.newPage());
  await context.addInitScript?.(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    if (!(window as any).chrome) (window as any).chrome = { runtime: {} };
  });

  try {
    await page.goto(SIMPLIFY_SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
  } catch (err: any) {
    console.log(
      `⚠️ page.goto timed out after 120s (${err?.name || "TimeoutError"}). Continuing to look for job cards...`,
    );
  }
  // Simplify job list: cards in the left pane with data-testid="job-card".
  const jobCardSelector = '[data-testid="job-card"]';
  try {
    await page.waitForSelector(jobCardSelector, { timeout: 25000 });
  } catch {
    console.log("❌ No job cards ([data-testid='job-card']) appeared within 25s. Page may require login or the list is empty.");
    await context.close();
    return;
  }
  await page.waitForTimeout(800);

  let cardCount = await page.locator(jobCardSelector).count();
  if (cardCount === 0) {
    console.log("❌ No job cards found. Page may require login.");
    await context.close();
    return;
  }

  console.log(
    `Found ${cardCount} visible job card(s). Will scroll to load more and save up to ${MAX_JOBS_PER_RUN} new job(s).\n`,
  );

  let processed = 0;
  const processedJobIds = new Set<string>();
  let scrollRoundsWithNoNewJobs = 0;

  while (processed < MAX_JOBS_PER_RUN) {
    const cards = page.locator(jobCardSelector);
    const count = await cards.count();
    if (count === 0) break;

    let newThisRound = 0;
    for (let idx = 0; idx < count; idx++) {
      if (processed >= MAX_JOBS_PER_RUN) break;

      const card = cards.nth(idx);
      const jobIdFromCard = await getJobIdFromCard(card).catch(() => null);
      if (jobIdFromCard && processedJobIds.has(jobIdFromCard)) continue;

      try {
        await dismissSimplifyModal(page).catch(() => {});
        await card.scrollIntoViewIfNeeded().catch(() => {});
        await card.click({ timeout: 15000 });

        const rightPane = page.locator("[data-testid=\"details-view\"]").first();
        try {
          await rightPane.waitFor({ state: "visible", timeout: 15000 });
        } catch {
          console.log("  ⏭️ Skip: right pane (details-view) did not load");
          continue;
        }
        await page.waitForTimeout(400);

        // Add current job to processed set (from URL so we don't re-process after scroll)
        try {
          const u = new URL(page.url());
          const jobId = u.searchParams.get("jobId");
          if (jobId) processedJobIds.add(jobId);
        } catch {}

        const companySection = rightPane.locator('[id^="company-"]').first();
        const hasCompanySection = (await companySection.count()) > 0;

        const company = hasCompanySection
          ? (await companySection
              .locator("p.text-lg.font-bold.text-secondary-400")
              .first()
              .innerText()
              .catch(() => ""))?.trim() ||
            (await companySection.locator("img[alt]").first().getAttribute("alt").catch(() => ""))?.trim() ||
            "Unknown"
          : (await rightPane.locator("p.text-lg.font-bold.text-secondary-400").first().innerText().catch(() => ""))?.trim() ||
            "Unknown";

        let externalUrl = page.url();
        const applyBtn = page.getByRole("button", { name: /^Apply$/i }).first();
        if ((await applyBtn.count()) > 0) {
          try {
            await applyBtn.scrollIntoViewIfNeeded().catch(() => {});
            await page.waitForTimeout(200);
            const [newPage] = await Promise.all([
              context.waitForEvent("page", { timeout: 10000 }),
              applyBtn.click({ timeout: 10000 }),
            ]);
            await newPage.waitForLoadState("domcontentloaded").catch(() => {});
            await newPage.waitForTimeout(1000);
            const destUrl = newPage.url();
            await newPage.close();
            if (destUrl && destUrl !== "about:blank") {
              externalUrl = normalizeCompanyUrl(destUrl);
            }
            await dismissSimplifyModal(page);
          } catch (err: any) {
            console.log(`  ❌ Apply click failed or no new tab opened: ${err?.message || err}`);
          }
        }

        if (!externalUrl || externalUrl.startsWith("https://simplify.jobs")) {
          externalUrl = page.url();
          const fullPostingLink = rightPane.locator('a:has-text("Full Job Posting")').first();
          if ((await fullPostingLink.count()) > 0) {
            const hrefFull = await fullPostingLink.getAttribute("href").catch(() => null);
            if (hrefFull?.trim()) externalUrl = normalizeCompanyUrl(hrefFull.trim());
          } else {
            const websiteLink = (hasCompanySection ? companySection : rightPane).locator('a[href*="utm_source=Simplify"]').first();
            if ((await websiteLink.count()) > 0) {
              const siteHref = await websiteLink.getAttribute("href").catch(() => null);
              if (siteHref && !siteHref.includes("simplify.jobs")) {
                externalUrl = normalizeCompanyUrl(siteHref);
              }
            }
          }
        }

        let title =
          (await rightPane.locator("h1").first().innerText().catch(() => ""))?.trim() || "";
        if (!title) {
          const firstP = await rightPane.locator("p.text-sm.text-secondary-400").first().innerText().catch(() => "");
          const match = firstP.match(/As (?:a|an) ([^.]+?) (?:on our|at |\.)/i);
          title = match ? match[1].trim() : firstP.slice(0, 80).trim() || "";
        }
        if (!title) title = "Unknown";

        const descParas = await rightPane.locator("p.text-sm.text-secondary-400").allInnerTexts().catch(() => []);
        let description = descParas.slice(0, 40).join("\n\n").trim();
        const simplifyTakeIndex = description.indexOf("Simplify's Take");
        if (simplifyTakeIndex > 50) description = description.slice(0, simplifyTakeIndex).trim();
        if (description.length < 50) description = descParas.join("\n\n").trim();

        console.log(`  📄 ${title} @ ${company}`);

        const duplicate = await findDuplicateJob({
          userId: actualUserId,
          externalUrl,
          title,
          company,
        });
        if (duplicate) {
          console.log(`  ⏭️ Skip: duplicate (${duplicate.reason})`);
          continue;
        }

        const saved = await upsertJobApplication({
          userId: actualUserId,
          source: "simplify",
          title,
          company,
          externalUrl,
          location: "Remote",
        });

        if (description && description.length >= 30) {
          await saveJobDescription(saved.id, description);
          console.log(`  ✅ Saved (${description.length} chars)`);
        } else {
          console.log("  ⚠️ Saved with minimal description");
        }

        processed++;
        newThisRound++;
      } catch (err: any) {
        console.error(`  ❌ Error: ${err.message || err}`);
      }
    }

    if (processed >= MAX_JOBS_PER_RUN) break;

    const countBeforeScroll = await page.locator(jobCardSelector).count();
    await scrollJobList(page);
    await page.waitForTimeout(SCROLL_WAIT_MS);
    const countAfterScroll = await page.locator(jobCardSelector).count();

    const hasNewCards = countAfterScroll > countBeforeScroll;
    const hasNewJobIds = await (async () => {
      const cards2 = page.locator(jobCardSelector);
      const n = await cards2.count();
      for (let i = 0; i < Math.min(n, 5); i++) {
        const id = await getJobIdFromCard(cards2.nth(i)).catch(() => null);
        if (id && !processedJobIds.has(id)) return true;
      }
      return false;
    })();

    if (!hasNewCards && !hasNewJobIds) {
      scrollRoundsWithNoNewJobs++;
      if (scrollRoundsWithNoNewJobs >= MAX_SCROLL_ROUNDS_NO_NEW) {
        console.log("\n  No more new jobs after scrolling. Stopping.");
        break;
      }
    } else {
      scrollRoundsWithNoNewJobs = 0;
    }
  }

  console.log(`\n✅ Simplify scan complete. Processed ${processed} job(s).`);
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
