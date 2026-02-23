/**
 * Exploration script for ZipRecruiter - inspect page structure, selectors, etc.
 * Run: npm run explore:ziprecruiter
 * Uses playwright-extra + stealth plugin to reduce bot detection.
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

const PERSISTENT_CONTEXT_DIR = expandPath(process.env.ZIPRECRUITER_CONTEXT_DIR);

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

async function exploreZipRecruiter() {
  console.log("🔍 Exploring ZipRecruiter structure...\n");
  console.log("Using persistent context: " + PERSISTENT_CONTEXT_DIR);
  console.log("(Run npm run ziprecruiter:init first if you haven't passed Cloudflare yet)\n");

  if (!fs.existsSync(PERSISTENT_CONTEXT_DIR)) {
    console.log("⚠️  No persistent context found. Run: npm run ziprecruiter:init");
    console.log("   This will let you pass Cloudflare once and save the session.\n");
  }

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    console.error("❌ Chrome not found. Set ZIPRECRUITER_CHROME_PATH to chrome.exe or install Chrome.");
    process.exit(1);
  }

  chromium.use(StealthPlugin());

  // Try FlareSolverr for fresh cookies if available
  const flaresolverrUrl = process.env.FLARESOLVERR_URL || "http://localhost:8191";
  let flaresolverrCookies: { name: string; value: string; domain: string; path: string; expires?: number; httpOnly?: boolean; secure?: boolean; sameSite?: string }[] = [];
  let flaresolverrUA = "";
  try {
    const res = await fetch(`${flaresolverrUrl}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "request.get", url: ZIPRECRUITER_SEARCH_URL, maxTimeout: 60000 }),
    });
    const data = (await res.json()) as { status?: string; solution?: { cookies?: any[]; userAgent?: string } };
    if (data.status === "ok" && data.solution?.cookies?.length) {
      flaresolverrCookies = data.solution.cookies.map((c: any) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || ".ziprecruiter.com",
        path: c.path || "/",
        expires: c.expires != null ? Math.floor(Number(c.expires)) : undefined,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite,
      }));
      flaresolverrUA = data.solution.userAgent || "";
      console.log(`✅ FlareSolverr: ${flaresolverrCookies.length} cookies\n`);
    }
  } catch (_) {}

  const launchOpts: Record<string, unknown> = {
    executablePath: chromePath,
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  };
  if (flaresolverrUA) launchOpts.userAgent = flaresolverrUA;
  const context = await chromium.launchPersistentContext(PERSISTENT_CONTEXT_DIR, launchOpts);

  const page = context.pages()[0] || (await context.newPage());
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
  if (flaresolverrCookies.length > 0) {
    await context.addCookies(flaresolverrCookies);
  } else {
    const cookiesFile =
      process.env.ZIPRECRUITER_COOKIES_FILE || path.join(path.dirname(PERSISTENT_CONTEXT_DIR), "ziprecruiter-cookies.json");
    if (fs.existsSync(cookiesFile)) {
      const cookies = loadCookiesFromFile(cookiesFile);
      await context.addCookies(cookies);
      console.log(`Loaded ${cookies.length} cookies from file\n`);
    }
  }

  try {
    console.log("📄 Navigating to ZipRecruiter search page...");
    await page.goto(ZIPRECRUITER_SEARCH_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(3000);

    const cf = await isCloudflareChallenge(page);
    if (cf) {
      console.log("\n⚠️  Cloudflare detected. Please complete verification in the browser, then press ENTER.");
      await new Promise<void>((r) => process.stdin.once("data", () => r()));
      await page.waitForTimeout(2000);
    }

    console.log("\n✅ Page loaded. Current URL:", page.url());
    console.log("\n📋 Let's inspect the page structure:\n");

    // 1. Check for job listings/cards
    console.log("1️⃣ Looking for job listings...");
    const jobSelectors = [
      "[data-testid*='job']",
      "[class*='job']",
      "[class*='Job']",
      "[id*='job']",
      "article",
      "[role='article']",
      "li[class*='job']",
      "div[class*='job-card']",
      "div[class*='job-item']",
    ];

    for (const selector of jobSelectors) {
      try {
        const elements = await page.locator(selector).all();
        if (elements.length > 0) {
          console.log(`   ✓ Found ${elements.length} elements with selector: ${selector}`);
          if (elements.length <= 5) {
            // Show text content of first few
            for (let i = 0; i < Math.min(elements.length, 3); i++) {
              const text = await elements[i].innerText().catch(() => "");
              console.log(`      [${i + 1}] ${text.substring(0, 100)}...`);
            }
          }
        }
      } catch (e) {
        // Continue
      }
    }

    // 2. Look for job title selectors
    console.log("\n2️⃣ Looking for job titles...");
    const titleSelectors = [
      "h2",
      "h3",
      "[class*='title']",
      "[class*='Title']",
      "[data-testid*='title']",
      "a[class*='job']",
    ];

    for (const selector of titleSelectors) {
      try {
        const elements = await page.locator(selector).all();
        if (elements.length > 0 && elements.length < 50) {
          const sampleTexts: string[] = [];
          for (let i = 0; i < Math.min(elements.length, 5); i++) {
            const text = await elements[i].innerText().catch(() => "");
            if (text && text.length > 10 && text.length < 200) {
              sampleTexts.push(text);
            }
          }
          if (sampleTexts.length > 0) {
            console.log(`   ✓ Found ${elements.length} potential titles with: ${selector}`);
            sampleTexts.forEach((t, i) => console.log(`      [${i + 1}] ${t}`));
          }
        }
      } catch (e) {
        // Continue
      }
    }

    // 3. Look for company names
    console.log("\n3️⃣ Looking for company names...");
    const companySelectors = [
      "[class*='company']",
      "[class*='Company']",
      "[data-testid*='company']",
      "span[class*='company']",
    ];

    for (const selector of companySelectors) {
      try {
        const elements = await page.locator(selector).all();
        if (elements.length > 0 && elements.length < 50) {
          const sampleTexts: string[] = [];
          for (let i = 0; i < Math.min(elements.length, 5); i++) {
            const text = await elements[i].innerText().catch(() => "");
            if (text && text.length > 2 && text.length < 100) {
              sampleTexts.push(text);
            }
          }
          if (sampleTexts.length > 0) {
            console.log(`   ✓ Found ${elements.length} potential companies with: ${selector}`);
            sampleTexts.forEach((t, i) => console.log(`      [${i + 1}] ${t}`));
          }
        }
      } catch (e) {
        // Continue
      }
    }

    // 4. Look for apply buttons/links
    console.log("\n4️⃣ Looking for apply buttons/links...");
    const applySelectors = [
      "button:has-text('Apply')",
      "a:has-text('Apply')",
      "[class*='apply']",
      "[class*='Apply']",
      "[data-testid*='apply']",
      "button[aria-label*='Apply']",
    ];

    for (const selector of applySelectors) {
      try {
        const elements = await page.locator(selector).all();
        if (elements.length > 0 && elements.length < 50) {
          console.log(`   ✓ Found ${elements.length} potential apply buttons with: ${selector}`);
          for (let i = 0; i < Math.min(elements.length, 3); i++) {
            const text = await elements[i].innerText().catch(() => "");
            const href = await elements[i].getAttribute("href").catch(() => "");
            console.log(`      [${i + 1}] Text: "${text}" | href: ${href || "none"}`);
          }
        }
      } catch (e) {
        // Continue
      }
    }

    // 5. Check pagination
    console.log("\n5️⃣ Looking for pagination...");
    const paginationSelectors = [
      "[class*='pagination']",
      "[class*='Pagination']",
      "button:has-text('Next')",
      "a:has-text('Next')",
      "[aria-label*='next']",
      "[aria-label*='Next']",
    ];

    for (const selector of paginationSelectors) {
      try {
        const elements = await page.locator(selector).all();
        if (elements.length > 0) {
          console.log(`   ✓ Found pagination elements with: ${selector}`);
        }
      } catch (e) {
        // Continue
      }
    }

    // 6. Get page HTML structure (sample)
    console.log("\n6️⃣ Page structure sample (first 2000 chars of body HTML):");
    const bodyHTML = await page.locator("body").innerHTML().catch(() => "");
    console.log(bodyHTML.substring(0, 2000));

    console.log("\n\n⏸️  Browser will stay open for manual inspection. Press Enter to close...");
    await new Promise((resolve) => {
      process.stdin.once("data", () => resolve(null));
    });

  } catch (error: any) {
    console.error("❌ Error:", error.message);
  } finally {
    await context.close();
  }
}

exploreZipRecruiter().catch(console.error);
