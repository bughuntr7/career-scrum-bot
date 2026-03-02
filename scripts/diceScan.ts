/**
 * Dice.com scan:
 * - Uses the search URL (remote ML roles) and walks all job cards on the results page
 * - Extracts title, company, location, and the short description snippet from the card
 * - Opens each job detail page to get full description (JSON-LD or description div)
 * - Uses the Dice job-detail URL as externalUrl. Skips duplicates via findDuplicateJob.
 * - Uses persistent context (run dice:init first to log in).
 *
 * Run: npm run dice:init  (once, to log in), then: npm run dice:scan
 */

import "dotenv/config";
import type { BrowserContext } from "playwright";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";

import { findDuplicateJob } from "../lib/jobDuplicateDetection";
import { upsertJobApplication } from "../lib/jobApplications";
import { prisma } from "../lib/prisma";

const DEFAULT_DICE_URL =
  "https://www.dice.com/jobs?filters.postedDate=ONE&filters.employmentType=FULLTIME%7CPARTTIME%7CCONTRACTS%7CTHIRD_PARTY&filters.workplaceTypes=Remote&location=United+States&q=machine+learning&latitude=38.7945952&longitude=-106.5348379&countryCode=US&locationPrecision=Country";

const DICE_SEARCH_URL = process.env.DICE_SEARCH_URL || DEFAULT_DICE_URL;
const MAX_JOBS_PER_RUN = Number(process.env.DICE_MAX_JOBS_PER_RUN ?? 10);
const USER_ID = Number(process.env.JOBBOT_USER_ID ?? 1);

function expandPath(dir: string | undefined): string {
  const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
  if (!dir) return path.join(home, ".jobbot", "dice");
  const cleanPath = dir.split(/\s+/)[0].trim().replace(/^["']|["']$/g, "");
  return cleanPath.replace(/\$HOME|^~/, home);
}

const PERSISTENT_CONTEXT_DIR = expandPath(process.env.DICE_CONTEXT_DIR);

function findChromeExecutable(): string | undefined {
  if (process.env.DICE_CHROME_PATH && fs.existsSync(process.env.DICE_CHROME_PATH)) {
    return process.env.DICE_CHROME_PATH;
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

async function saveJobDescription(
  jobApplicationId: number,
  description: string,
  source: "dice_snippet" | "dice_detail" = "dice_detail"
) {
  await prisma.jobDescription.upsert({
    where: { jobApplicationId },
    create: { jobApplicationId, fullText: description, source },
    update: { fullText: description },
  });
}

/** Strip HTML to plain text (rough). */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Open job detail page, wait for content to load (past skeleton), extract full description.
 * Uses JSON-LD script when available, else the description div.
 */
async function getFullDescriptionFromDetailPage(
  context: BrowserContext,
  jobDetailUrl: string
): Promise<string | null> {
  const detailPage = await context.newPage();
  try {
    await detailPage.goto(jobDetailUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    // Wait for real content: skeleton is replaced when JSON-LD or description div appears with content
    await detailPage.waitForTimeout(4000);

    // Prefer JSON-LD (stable and has full description)
    const jsonLdScript = await detailPage
      .locator('script[data-testid="jobDetailStructuredData"]')
      .first()
      .textContent()
      .catch(() => null);
    if (jsonLdScript && jsonLdScript.length > 200) {
      try {
        const data = JSON.parse(jsonLdScript) as { description?: string };
        if (data.description && data.description.length >= 50) {
          return stripHtml(data.description);
        }
      } catch {
        // ignore parse error
      }
    }

    // Fallback: description div (class contains jobDescription)
    const descDiv = detailPage.locator('[class*="jobDescription"]').first();
    if ((await descDiv.count()) > 0) {
      const text = (await descDiv.innerText().catch(() => ""))?.trim();
      if (text && text.length >= 50) return text;
    }

    return null;
  } finally {
    await detailPage.close().catch(() => {});
  }
}

async function main() {
  console.log("\n🔍 Dice.com Scanner\n");
  console.log(`Max jobs per run: ${MAX_JOBS_PER_RUN} (DICE_MAX_JOBS_PER_RUN)`);
  console.log(`Search URL: ${DICE_SEARCH_URL}`);
  console.log(`Using persistent context: ${PERSISTENT_CONTEXT_DIR}`);
  if (!fs.existsSync(PERSISTENT_CONTEXT_DIR)) {
    console.log("\n⚠️  No Dice session found. Run first: npm run dice:init (log in), then run this again.\n");
  }
  console.log("");

  const actualUserId = await ensureUserExists(USER_ID);

  chromium.use(StealthPlugin());

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error("❌ Google Chrome not found. Set DICE_CHROME_PATH or ZIPRECRUITER_CHROME_PATH.");
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
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    if (!(window as any).chrome) (window as any).chrome = { runtime: {} };
  });

  await page.goto(DICE_SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  // Wait for at least one job card
  const cardLocator = page.locator("[data-testid='job-card']");
  const firstCardCount = await cardLocator.count();
  if (firstCardCount === 0) {
    console.log("❌ No Dice job cards found on the page. Check that the search URL is correct and you are not blocked.");
    await context.close();
    await browser.close();
    return;
  }

  console.log(`Found ${firstCardCount} job cards on first page.\n`);

  let processed = 0;
  let cardIndex = 0;

  // Dice has pagination with "Next" and "Last" buttons inside nav[aria-label='Pagination']
  async function goToNextPage(): Promise<boolean> {
    const next = page
      .locator("nav[aria-label='Pagination'] [aria-label='Next'][role='link']")
      .first();
    if ((await next.count()) === 0) {
      return false;
    }
    const ariaDisabled = await next.getAttribute("aria-disabled").catch(() => null);
    const dataDisabled = await next.getAttribute("data-disabled").catch(() => null);
    if (ariaDisabled === "true" || dataDisabled === "true") {
      return false;
    }
    console.log("📄 Moving to next results page...");
    await next.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);
    return true;
  }

  while (processed < MAX_JOBS_PER_RUN) {
    const cardsOnPage = await cardLocator.count();

    if (cardIndex >= cardsOnPage) {
      const advanced = await goToNextPage();
      if (!advanced) {
        console.log("No more pages available. Stopping.");
        break;
      }
      cardIndex = 0;
      continue;
    }

    const card = cardLocator.nth(cardIndex);

    try {
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(300);

      // Title: from detail-link anchor in the card
      const title =
        (
          await card
            .locator("[data-testid='job-search-job-detail-link']")
            .first()
            .innerText()
            .catch(() => "")
        )?.trim() || "Unknown";

      // Company: from header p in the card
      const company =
        (
          await card
            .locator(".header p")
            .first()
            .innerText()
            .catch(() => "")
        )?.trim() || "Unknown";

      // Location: first small gray text in metadata row
      const location =
        (
          await card
            .locator("span.inline-flex p.text-sm.font-normal.text-zinc-600")
            .first()
            .innerText()
            .catch(() => "")
        )?.trim() || null;

      // Description snippet: 2-line summary in card body
      const snippet =
        (
          await card
            .locator("p.line-clamp-2")
            .first()
            .innerText()
            .catch(() => "")
        )?.trim() || "";

      // Dice job-detail URL (we use this as externalUrl for now)
      const href =
        (await card
          .locator("[data-testid='job-search-job-card-link']")
          .first()
          .getAttribute("href")
          .catch(() => null)) || null;
      if (!href) {
        console.log(`  ⏭️ Skip card #${cardIndex + 1}: no job-detail URL found`);
        cardIndex++;
        continue;
      }

      const jobUrl = href;

      console.log(
        `  📄 Card #${cardIndex + 1}: ${title} @ ${company}${
          location ? ` (${location})` : ""
        }`
      );

      // Duplicate check: shared logic across boards
      const duplicate = await findDuplicateJob({
        userId: actualUserId,
        externalUrl: jobUrl,
        title,
        company,
      });
      if (duplicate) {
        console.log(`  ⏭️ Skip: duplicate (${duplicate.reason})`);
        cardIndex++;
        continue;
      }

      const saved = await upsertJobApplication({
        userId: actualUserId,
        source: "dice",
        title,
        company,
        externalUrl: jobUrl,
        location,
      });

      // Fetch full description from job detail page (waits for content past skeleton)
      let descriptionToSave = await getFullDescriptionFromDetailPage(context, jobUrl);
      if (descriptionToSave && descriptionToSave.length >= 50) {
        await saveJobDescription(saved.id, descriptionToSave, "dice_detail");
        console.log(`  ✅ Saved full description (${descriptionToSave.length} chars)`);
      } else if (snippet && snippet.length >= 30) {
        await saveJobDescription(saved.id, snippet, "dice_snippet");
        console.log(`  ✅ Saved snippet (${snippet.length} chars)`);
      } else {
        console.log("  ⚠️ No usable description found; saved job without description.");
      }

      processed++;
      cardIndex++;
    } catch (err: any) {
      console.error(`  ❌ Error on card #${cardIndex + 1}: ${err.message || err}`);
      cardIndex++;
    }
  }

  console.log(`\n✅ Dice.com scan complete. Processed ${processed} job(s).`);
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

