import { chromium } from "playwright";
import * as fs from "fs";

const JOBRIGHT_RECOMMEND_URL = "https://jobright.ai/jobs/recommend";

// Expand $HOME if present in the path and clean any extra text
function expandPath(dir: string | undefined): string {
  if (!dir) {
    return `${process.env.HOME}/.jobbot/jobright`;
  }
  
  // Clean the path - remove any extra commands or text that might have been accidentally included
  // Take only the first part (the actual path) before any spaces or commands
  const cleanPath = dir.split(/\s+/)[0].trim();
  
  // Remove quotes if present
  const unquoted = cleanPath.replace(/^["']|["']$/g, '');
  
  // Replace $HOME or ~ with actual home directory
  return unquoted.replace(/\$HOME|^~/, process.env.HOME || process.env.USERPROFILE || '');
}

const PERSISTENT_CONTEXT_DIR = expandPath(process.env.JOBRIGHT_CONTEXT_DIR);

async function main() {
  console.log(`\n🔐 Jobright Login Helper\n`);
  console.log(`Using persistent context directory: ${PERSISTENT_CONTEXT_DIR}`);
  console.log(`(Make sure to use the SAME path when running: npm run jobright:scan)\n`);
  
  // Ensure the directory exists
  if (!fs.existsSync(PERSISTENT_CONTEXT_DIR)) {
    console.log(`Creating context directory: ${PERSISTENT_CONTEXT_DIR}`);
    fs.mkdirSync(PERSISTENT_CONTEXT_DIR, { recursive: true });
  }
  
  console.log("Opening browser window...");
  console.log("Please log in with YOUR Google account in the browser that opens.\n");
  
  const context = await chromium.launchPersistentContext(PERSISTENT_CONTEXT_DIR, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });

  const page = await context.newPage();
  
  // Hide automation indicators
  await page.addInitScript(() => {
    // Remove webdriver property
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
    
    // Override the plugins property to use a custom getter
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    
    // Override the languages property to use a custom getter
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
    
    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission } as PermissionStatus) :
        originalQuery(parameters)
    );
  });
  
  // Set a realistic user agent
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });
  
  console.log(`Navigating to: ${JOBRIGHT_RECOMMEND_URL}`);
  await page.goto(JOBRIGHT_RECOMMEND_URL, { waitUntil: "domcontentloaded" });
  
  console.log("\n✅ Browser window is open!");
  console.log("📋 Instructions:");
  console.log("   1. Log in with YOUR Google account in the browser window");
  console.log("   2. Make sure you can see the 'Recommended' jobs board");
  console.log("   3. Keep this terminal window open");
  console.log("   4. Press ENTER in this terminal when you're done logging in\n");
  
  // Wait for user to press Enter
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => {
      resolve();
    });
  });
  
  // Verify login
  await page.waitForTimeout(2000);
  const hasJobCards = await page.locator("section[data-testid='job-card'], div[data-testid='job-card']").count() > 0;
  const hasLoginPrompt = await page.locator("text=/sign in|log in|continue with google/i").count() > 0;
  
  if (hasLoginPrompt && !hasJobCards) {
    console.log("\n❌ ERROR: Still not logged in. Please try again.");
    await context.close();
    process.exit(1);
  }
  
  if (hasJobCards) {
    console.log("\n✅ SUCCESS! You are logged in and job cards are visible.");
    console.log("Your login session has been saved to the persistent context.");
    console.log("You can now close the browser window.\n");
  } else {
    console.log("\n⚠️  Warning: Could not detect job cards, but continuing anyway...");
  }
  
  // Keep browser open for a moment so user can verify
  await page.waitForTimeout(3000);
  await context.close();
  
  console.log("✅ Login session saved! You can now run: npm run jobright:scan\n");
}

main().catch((err) => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
