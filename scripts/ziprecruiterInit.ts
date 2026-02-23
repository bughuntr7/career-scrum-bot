/**
 * ZipRecruiter init: pass Cloudflare verification and optionally sign in.
 * Uses playwright-extra + stealth plugin to reduce bot detection.
 * Run once: npm run ziprecruiter:init
 */

import "dotenv/config";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import * as fs from "fs";
import * as path from "path";

const DEFAULT_ZIPRECRUITER_URL =
  "https://www.ziprecruiter.com/jobs-search?search=Machine+Learning+Engineer&location=Remote+%28USA%29&days=5&page=1";
const ZIPRECRUITER_SEARCH_URL =
  process.env.ZIPRECRUITER_SEARCH_URL || DEFAULT_ZIPRECRUITER_URL;

function expandPath(dir: string | undefined): string {
  const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
  if (!dir) return path.join(home, ".jobbot", "ziprecruiter");
  const cleanPath = dir.split(/\s+/)[0].trim().replace(/^["']|["']$/g, "");
  return cleanPath.replace(/\$HOME|^~/, home);
}

const PERSISTENT_CONTEXT_DIR = expandPath(process.env.ZIPRECRUITER_CONTEXT_DIR);

/** Find Chrome executable on Windows (or use env ZIPRECRUITER_CHROME_PATH) */
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

async function isCloudflareChallenge(page: any): Promise<boolean> {
  try {
    const hasVerify = await page.locator("text=Verify you are human").count() > 0;
    const hasSecurity = await page.locator("text=Performing security verification").count() > 0;
    const hasCloudflare = await page.locator("text=security service to protect against").count() > 0;
    return !!(hasVerify || hasSecurity || hasCloudflare);
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

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || "http://localhost:8191";

/** Fetch cookies from FlareSolverr (bypasses Cloudflare). Requires: docker run -d -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest */
async function fetchCookiesViaFlareSolverr(url: string): Promise<{ cookies: PlaywrightCookie[]; userAgent: string } | null> {
  try {
    const res = await fetch(`${FLARESOLVERR_URL}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 60000 }),
    });
    const data = (await res.json()) as { status: string; solution?: { cookies?: any[]; userAgent?: string } };
    if (data.status !== "ok" || !data.solution?.cookies) return null;
    const cookies: PlaywrightCookie[] = (data.solution.cookies || []).map((c: any) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || ".ziprecruiter.com",
      path: c.path || "/",
      ...(c.expires != null && { expires: Math.floor(Number(c.expires)) }),
      ...(c.httpOnly != null && { httpOnly: !!c.httpOnly }),
      ...(c.secure != null && { secure: !!c.secure }),
      ...(c.sameSite && { sameSite: (c.sameSite === "None" ? "None" : c.sameSite === "Lax" ? "Lax" : "Strict") as "Strict" | "Lax" | "None" }),
    }));
    return { cookies, userAgent: data.solution.userAgent || "" };
  } catch (e) {
    return null;
  }
}

/** Load cookies from JSON file (Cookie-Editor / EditThisCookie format) */
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

async function main() {
  console.log("\n🔐 ZipRecruiter Init (Cloudflare + optional login)\n");
  console.log(`Using persistent context: ${PERSISTENT_CONTEXT_DIR}`);
  console.log(`(Set ZIPRECRUITER_CONTEXT_DIR to override)\n`);

  if (!fs.existsSync(PERSISTENT_CONTEXT_DIR)) {
    fs.mkdirSync(PERSISTENT_CONTEXT_DIR, { recursive: true });
  }

  // Use installed Chrome (not Playwright's Chromium) - Cloudflare often blocks Chromium
  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error("❌ Google Chrome not found. Install Chrome or set ZIPRECRUITER_CHROME_PATH to chrome.exe path.");
    console.error("   Example: set ZIPRECRUITER_CHROME_PATH=C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
    process.exit(1);
  }
  console.log(`Using Chrome: ${chromePath}\n`);

  chromium.use(StealthPlugin());

  // Try FlareSolverr first (best for Cloudflare) - no browser needed for this step
  const flaresolverr = await fetchCookiesViaFlareSolverr(ZIPRECRUITER_SEARCH_URL);
  // Launch options from BrowserStack/evasion guides: hide automation, realistic context
  const launchOpts: Record<string, unknown> = {
    executablePath: chromePath,
    headless: false,
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "America/New_York",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  };
  if (flaresolverr?.userAgent) {
    launchOpts.userAgent = flaresolverr.userAgent;
  }

  const context = await chromium.launchPersistentContext(PERSISTENT_CONTEXT_DIR, launchOpts);

  const page = context.pages()[0] || (await context.newPage());
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

  // Reinforce removal of automation indicators (BrowserStack guide)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    if (!(window as any).chrome) (window as any).chrome = { runtime: {} };
  });

  if (flaresolverr && flaresolverr.cookies.length > 0) {
    console.log(`✅ FlareSolverr solved Cloudflare. Loaded ${flaresolverr.cookies.length} cookies.`);
    await context.addCookies(flaresolverr.cookies);
  } else {
    console.log("FlareSolverr not available. Tip: run Docker to bypass Cloudflare:");
    console.log("  docker run -d -p 8191:8191 ghcr.io/flaresolverr/flaresolverr:latest\n");
    // 2) Fallback: cookie file from manual export
    const cookiesFile =
      process.env.ZIPRECRUITER_COOKIES_FILE || path.join(path.dirname(PERSISTENT_CONTEXT_DIR), "ziprecruiter-cookies.json");
    if (fs.existsSync(cookiesFile)) {
      console.log(`Loading cookies from: ${cookiesFile}`);
      const cookies = loadCookiesFromFile(cookiesFile);
      await context.addCookies(cookies);
      console.log(`  Loaded ${cookies.length} cookies.\n`);
    }
  }

  // Short human-like delay before navigation (Bright Data / behavioral)
  await page.waitForTimeout(1000 + Math.floor(Math.random() * 2000));

  console.log("Opening ZipRecruiter search page...");
  await page.goto(ZIPRECRUITER_SEARCH_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  // Wait for Cloudflare challenge to auto-resolve if present (BrowserStack: waitForFunction)
  try {
    await page.waitForFunction(
      () => {
        const body = document.body?.innerText || "";
        const title = document.title || "";
        return (
          !title.includes("Just a moment") &&
          !body.includes("Performing security verification") &&
          !body.includes("Verify you are human")
        );
      },
      { timeout: 45000 }
    );
    await page.waitForTimeout(2000 + Math.floor(Math.random() * 2000));
  } catch {
    // Timeout: challenge may still be visible, fall through to check
  }

  const cf = await isCloudflareChallenge(page);
  if (cf) {
    console.log("\n⚠️  Cloudflare verification detected.");
    console.log("   Please complete the 'Verify you are human' checkbox in the browser.");
    console.log("   After the page loads, press ENTER here.\n");
    await new Promise<void>((resolve) => {
      process.stdin.once("data", () => resolve());
    });
    await page.waitForTimeout(2000);
    const stillCf = await isCloudflareChallenge(page);
    if (stillCf) {
      console.log("\n❌ Cloudflare challenge still visible. Try FlareSolverr (Docker) or wait longer.");
      await context.close();
      process.exit(1);
    }
    console.log("✅ Cloudflare passed.\n");
  }

  console.log("✅ Session saved. You can now run: npm run explore:ziprecruiter or the ZipRecruiter scan.");
  console.log("Press ENTER to close the browser.\n");
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  await context.close();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
