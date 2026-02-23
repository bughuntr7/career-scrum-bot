/**
 * Glassdoor init: load cookies (from nodriver export), open search page, pass Cloudflare if needed.
 * Run once after: python scripts/glassdoor_nodriver.py
 * Then: npm run glassdoor:init
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_GLASSDOOR_URL =
  "https://www.glassdoor.com/Job/remote-machine-learning-engineer-jobs-SRCH_IL.0,6_IS11047_KO7,32.htm?fromAge=7&remoteWorkType=1";
const GLASSDOOR_SEARCH_URL = process.env.GLASSDOOR_SEARCH_URL || DEFAULT_GLASSDOOR_URL;

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

async function isCloudflareChallenge(page: any): Promise<boolean> {
  try {
    const hasVerify = await page.locator("text=Verify you are human").count() > 0;
    const hasSecurity = await page.locator("text=Performing security verification").count() > 0;
    const hasJustAMoment = await page.locator("text=Just a moment").count() > 0;
    return !!(hasVerify || hasSecurity || hasJustAMoment);
  } catch {
    return false;
  }
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

async function main() {
  console.log("\n🔐 Glassdoor Init (Cloudflare + optional login)\n");
  console.log(`Using persistent context: ${PERSISTENT_CONTEXT_DIR}`);
  console.log(`(Set GLASSDOOR_CONTEXT_DIR to override)\n`);

  if (!fs.existsSync(PERSISTENT_CONTEXT_DIR)) {
    fs.mkdirSync(PERSISTENT_CONTEXT_DIR, { recursive: true });
  }

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error("❌ Google Chrome not found. Set GLASSDOOR_CHROME_PATH or ZIPRECRUITER_CHROME_PATH.");
    process.exit(1);
  }
  console.log(`Using Chrome: ${chromePath}\n`);

  chromium.use(StealthPlugin());

  const cookiesFile =
    process.env.GLASSDOOR_COOKIES_FILE || path.join(path.dirname(PERSISTENT_CONTEXT_DIR), "glassdoor-cookies.json");
  if (!fs.existsSync(cookiesFile)) {
    console.error("❌ Cookie file not found. Run first: python scripts/glassdoor_nodriver.py");
    console.error(`   Expected: ${cookiesFile}`);
    process.exit(1);
  }
  const cookies = loadCookiesFromFile(cookiesFile);
  console.log(`Loading ${cookies.length} cookies from ${cookiesFile}\n`);

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

  await context.addCookies(cookies);

  console.log("Opening Glassdoor search page...");
  await page.goto(GLASSDOOR_SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  const cf = await isCloudflareChallenge(page);
  if (cf) {
    console.log("\n⚠️  Cloudflare verification detected. Complete it in the browser, then press ENTER.\n");
    await new Promise<void>((r) => process.stdin.once("data", () => r()));
    await page.waitForTimeout(2000);
  }

  console.log("✅ Session saved. You can run: npm run glassdoor:scan");
  console.log("Press ENTER to close the browser.\n");
  await new Promise<void>((r) => process.stdin.once("data", () => r()));
  await context.close();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
