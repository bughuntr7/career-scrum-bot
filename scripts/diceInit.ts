/**
 * Dice init: open Dice in a persistent browser so you can log in.
 * Session (cookies, login) is saved and reused by dice:scan.
 * Run once: npm run dice:init
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_DICE_URL =
  "https://www.dice.com/jobs?filters.postedDate=ONE&filters.employmentType=FULLTIME%7CPARTTIME%7CCONTRACTS%7CTHIRD_PARTY&filters.workplaceTypes=Remote&location=United+States&q=machine+learning&latitude=38.7945952&longitude=-106.5348379&countryCode=US&locationPrecision=Country";
const DICE_SEARCH_URL = process.env.DICE_SEARCH_URL || DEFAULT_DICE_URL;

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

async function main() {
  console.log("\n🔐 Dice Init (login step)\n");
  console.log(`Using persistent context: ${PERSISTENT_CONTEXT_DIR}`);
  console.log(`(Set DICE_CONTEXT_DIR to override)\n`);

  if (!fs.existsSync(PERSISTENT_CONTEXT_DIR)) {
    fs.mkdirSync(PERSISTENT_CONTEXT_DIR, { recursive: true });
  }

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error("❌ Google Chrome not found. Set DICE_CHROME_PATH or ZIPRECRUITER_CHROME_PATH.");
    process.exit(1);
  }
  console.log(`Using Chrome: ${chromePath}\n`);

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

  console.log("Opening Dice search page...");
  await page.goto(DICE_SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);

  console.log("\n👉 Log in to Dice in the browser if prompted (session will be saved).");
  console.log("   When done, press ENTER here to close and save.\n");
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  await context.close();
  console.log("✅ Session saved. Run: npm run dice:scan\n");
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
