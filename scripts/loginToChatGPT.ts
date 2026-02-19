/**
 * ChatGPT login helper – sign in once; session is reused by test:chatgpt-ui.
 *
 * Usage: npm run chatgpt:login
 *
 * Env: CHATGPT_CONTEXT_DIR (default: .jobbot/chatgpt under user home)
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const CHATGPT_URL = "https://chat.openai.com";

function expandPath(dir: string | undefined): string {
  const base = process.env.USERPROFILE || process.env.HOME || ".";
  if (!dir) {
    return path.join(base, ".jobbot", "chatgpt");
  }
  const clean = dir.split(/\s+/)[0].trim().replace(/^["']|["']$/g, "");
  return path.resolve(clean.replace(/^~/, base));
}

async function main() {
  const contextDir = expandPath(process.env.CHATGPT_CONTEXT_DIR);

  console.log("\n🔐 ChatGPT Login Helper\n");
  console.log("Using context directory:", contextDir);
  console.log("(Same path is used by: npm run test:chatgpt-ui)\n");

  if (!fs.existsSync(contextDir)) {
    fs.mkdirSync(contextDir, { recursive: true });
  }

  console.log("Opening browser...");
  const context = await chromium.launchPersistentContext(contextDir, {
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  const page = await context.newPage();
  await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded" });

  console.log("\n✅ Browser is open.");
  console.log("📋 Instructions:");
  console.log("   1. In the browser, log in to ChatGPT (e.g. with Google or email).");
  console.log("   2. Wait until you see the chat interface (message input).");
  console.log("   3. Come back here and press ENTER.\n");

  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  await page.waitForTimeout(2000);
  const url = page.url();
  const isAuth = /auth\/login|auth\/callback/i.test(url) || url.includes("/auth/");

  if (isAuth) {
    console.log("\n⚠️  Still on login/auth page. If you just logged in, wait a few seconds and run this again.");
    console.log("    Or log in now in the browser and press ENTER again next time.\n");
  } else {
    console.log("\n✅ Session saved. You can run: npm run test:chatgpt-ui\n");
  }

  await page.waitForTimeout(2000);
  await context.close();
}

main().catch((err) => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
