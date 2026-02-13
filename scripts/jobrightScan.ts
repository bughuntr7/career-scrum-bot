import { chromium, BrowserContext, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";

import { upsertJobApplication } from "../lib/jobApplications";
import { prisma } from "../lib/prisma";
import { generateResumeAndCoverLetter } from "../lib/generateDocuments";

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
const MAX_JOBS_PER_RUN = Number(process.env.MAX_JOBS ?? 5);
const USER_ID = Number(process.env.JOBBOT_USER_ID ?? 1);
// Default to true - can be disabled via environment variable or UI
const AUTO_GENERATE_DOCUMENTS = process.env.AUTO_GENERATE_DOCUMENTS !== "false";
// Minimum Jobright match score (0–100) required to process a job
const MATCH_SCORE_THRESHOLD = Number(process.env.MATCH_SCORE_THRESHOLD ?? 80);

async function ensureLoggedIn(page: Page) {
  console.log(`Navigating to ${JOBRIGHT_RECOMMEND_URL}...`);
  
  // Use a more lenient wait strategy
  await page.goto(JOBRIGHT_RECOMMEND_URL, { 
    waitUntil: "domcontentloaded",
    timeout: 60000 
  });
  
  // Wait a bit for any dynamic content
  await page.waitForTimeout(3000);
  
  // Check if we're logged in by looking for job cards or login indicators
  const hasJobCards = await page.locator("section[data-testid='job-card'], div[data-testid='job-card']").count() > 0;
  const hasLoginPrompt = await page.locator("text=/sign in|log in|continue with google/i").count() > 0;
  
  if (hasLoginPrompt && !hasJobCards) {
    console.error("\n❌ ERROR: You are NOT logged in to Jobright!");
    console.error(`\nPlease do the following:`);
    console.error(`1. Run: JOBRIGHT_CONTEXT_DIR="${PERSISTENT_CONTEXT_DIR}" npx playwright open ${JOBRIGHT_RECOMMEND_URL}`);
    console.error(`2. Log in with Google in the browser window that opens`);
    console.error(`3. Make sure you can see the Recommended jobs board`);
    console.error(`4. Close the browser window`);
    console.error(`5. Run this script again\n`);
    throw new Error("Not logged in to Jobright. Please log in first using the command above.");
  }
  
  if (hasJobCards) {
    console.log("✅ Successfully logged in and found job cards!");
  } else {
    console.warn("⚠️  Warning: Could not detect job cards. The page may still be loading or the selectors need adjustment.");
  }
}

async function getJobCards(page: Page) {
  console.log("Looking for job cards...");
  
  // Wait a bit for dynamic content to load
  await page.waitForTimeout(3000);
  
  // Try multiple selectors based on the actual Jobright DOM structure
  const selectors = [
    "section[data-testid='job-card']",
    "div[data-testid='job-card']",
    "div[class*='job-card']",
    "div[class*='JobCard']",
    "article[class*='job']",
    "div[class*='card']:has(button:has-text('APPLY'))",
  ];
  
  for (const selector of selectors) {
    const cardLocator = page.locator(selector);
    const count = await cardLocator.count();
    if (count > 0) {
      console.log(`✅ Found ${count} job cards using selector: ${selector}`);
      return Array.from({ length: count }, (_, i) => cardLocator.nth(i));
    }
  }
  
  console.warn("⚠️  No job cards found with any selector. The page structure may have changed.");
  console.warn("Current URL:", page.url());
  
  // Debug: take a screenshot or log page content
  const pageContent = await page.content();
  if (pageContent.includes("sign in") || pageContent.includes("log in")) {
    console.error("❌ ERROR: Page shows login prompt. You may not be logged in.");
    console.error("Please run: npm run jobright:login");
  }
  
  return [];
}

async function extractCardMetadata(card: any) {
  // Extract job title
  const title = (await card.locator("h2, h3").first().innerText().catch(() => "")).trim();
  
  // Extract company name - try multiple selectors based on Jobright's DOM structure
  let company = "";
  const companySelectors = [
    "[class*='company-name']", // Specific class like index_company-name__jnxCX
    "div[class*='index_company-name']", // More specific pattern
    "div.ant-typography[class*='company']", // Ant Design with company class
    "div[class*='company']", // Generic company class
  ];
  
  for (const selector of companySelectors) {
    try {
      const companyElement = card.locator(selector).first();
      const count = await companyElement.count();
      if (count > 0) {
        const text = await companyElement.innerText();
        // Filter out text that looks like job title or other metadata
        if (text && text.length > 0 && text.length < 100 && !text.includes("/")) {
          company = text.trim();
          console.log(`  ✓ Found company using selector "${selector}": ${company}`);
          break;
        }
      }
    } catch (e) {
      // Try next selector
    }
  }
  
  // If still no company found, log for debugging
  if (!company || company === "") {
    console.warn(`  ⚠️  Could not extract company name for job: ${title}`);
  }
  
  // Fallback: look for text that appears after the title but before location
  if (!company || company === "") {
    try {
      // Try to find text that's not the title and not location-related
      const allText = await card.innerText();
      const lines = allText.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
      // Company is usually on a line by itself, after title, before location
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip if it's the title, location indicators, or too long
        if (
          line !== title &&
          !line.match(/Remote|United States|Full-time|Part-time|Contract/i) &&
          line.length < 50 &&
          line.length > 1 &&
          !line.match(/^\d+/) // Not starting with numbers
        ) {
          company = line;
          break;
        }
      }
    } catch (e) {
      // Ignore
    }
  }
  
  const location = (await card.locator("text=/Remote|United States|San Francisco|New York/i").first().innerText().catch(() => "")).trim();

  // Extract match score percentage (e.g., "76%", "92%")
  let matchScore: number | null = null;
  try {
    // Try to find the match score element - it's usually in a progress circle or percentage display
    const matchScoreSelectors = [
      "[class*='percent-value']", // Specific class for percentage value
      "[class*='match-score']",   // Generic match score class
      "[role='progressbar']",      // Progress bar role
      ".ant-progress-text",       // Ant Design progress text
    ];
    
    for (const selector of matchScoreSelectors) {
      try {
        const scoreElement = card.locator(selector).first();
        const count = await scoreElement.count();
        if (count > 0) {
          const text = await scoreElement.innerText().catch(() => "");
          // Look for percentage pattern (e.g., "76", "92", "76%")
          const match = text.match(/(\d+)/);
          if (match) {
            matchScore = parseFloat(match[1]);
            console.log(`  ✓ Found match score: ${matchScore}%`);
            break;
          }
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    // Fallback: search for percentage pattern in the entire card text
    if (matchScore === null) {
      try {
        const cardText = await card.innerText();
        // Look for patterns like "76%", "92% GOOD MATCH", etc.
        const percentageMatch = cardText.match(/(\d+)%\s*(GOOD\s*MATCH|MATCH|STRONG\s*MATCH)/i);
        if (percentageMatch) {
          matchScore = parseFloat(percentageMatch[1]);
          console.log(`  ✓ Found match score (fallback): ${matchScore}%`);
        }
      } catch (e) {
        // Ignore
      }
    }
  } catch (e) {
    // If extraction fails, just continue without match score
    console.warn(`  ⚠️  Could not extract match score`);
  }

  return {
    title: title || "Unknown title",
    company: company || "Unknown company",
    location: location || null,
    matchScore: matchScore,
  };
}

async function dismissApplyModal(page: Page) {
  // After returning from external site, Jobright shows a "Did you apply?" modal
  // We need to click "Yes, I applied!" to mark the job as applied and dismiss the modal
  // Note: After clicking "Yes", the job card will disappear from the recommended page (moved to Applied tab)
  try {
    // Wait a moment for the modal to appear
    await page.waitForTimeout(1500);
    
    // PRIORITY 1: Try class-based selector (most reliable from actual HTML structure)
    // The button has class "index_job-apply-confirm-popup-yes-button__WCBGU"
    const classBasedSelectors = [
      "button[class*='index_job-apply-confirm-popup-yes-button']", // Most specific
      "button[class*='job-apply-confirm-popup-yes-button']",       // Generic pattern
      "button.ant-btn[class*='yes-button']",                        // Ant Design with yes-button
    ];
    
    for (const selector of classBasedSelectors) {
      try {
        const button = page.locator(selector).first();
        const count = await button.count();
        if (count > 0) {
          const isVisible = await button.isVisible().catch(() => false);
          if (isVisible) {
            await button.click({ timeout: 5000 });
            console.log("✅ Clicked 'Yes, I applied!' button (class-based)");
            await page.waitForTimeout(1000); // Wait for modal to close and card to disappear
            return true;
          }
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    // PRIORITY 2: Try text-based selectors (text is in a span inside button)
    const textSelectors = [
      "button:has-text('Yes, I applied!')",  // Exact text match
      "button:has-text('Yes, I applied')",   // Without exclamation
      "button:has-text(/yes.*applied/i)",     // Case-insensitive regex
    ];
    
    for (const selector of textSelectors) {
      try {
        const button = page.locator(selector).first();
        const count = await button.count();
        if (count > 0) {
          const isVisible = await button.isVisible().catch(() => false);
          if (isVisible) {
            await button.click({ timeout: 5000 });
            console.log("✅ Clicked 'Yes, I applied!' button (text-based)");
            await page.waitForTimeout(1000);
            return true;
          }
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    // PRIORITY 3: Fallback - try to find any button with "Yes" or "applied" text in modal
    try {
      const modal = page.locator(".ant-modal-body, [role='dialog']").first();
      const allButtons = modal.locator("button");
      const btnCount = await allButtons.count();
      
      for (let i = 0; i < btnCount; i++) {
        const btn = allButtons.nth(i);
        const text = await btn.innerText().catch(() => "");
        if (text && /yes.*applied|applied.*yes/i.test(text)) {
          const isVisible = await btn.isVisible().catch(() => false);
          if (isVisible) {
            await btn.click({ timeout: 5000 });
            console.log(`✅ Clicked 'Yes, I applied!' button (fallback: "${text.trim()}")`);
            await page.waitForTimeout(1000);
            return true;
          }
        }
      }
    } catch (e) {
      // Continue to next fallback
    }
    
    // Last resort: Try close button (X) if "Yes" button not found
    try {
      const closeButton = page.locator("button[aria-label='Close'], button.ant-modal-close").first();
      const count = await closeButton.count();
      if (count > 0) {
        const isVisible = await closeButton.isVisible().catch(() => false);
        if (isVisible) {
          await closeButton.click({ timeout: 3000 });
          console.log("⚠️  Closed modal with X button (Yes button not found)");
          await page.waitForTimeout(500);
          return true;
        }
      }
    } catch (e) {
      // Modal might not be present, that's okay
    }
    
    return false;
  } catch (e) {
    // Modal might not be present, that's okay
    return false;
  }
}

// Extract job description from external company site
async function extractJobDescription(targetPage: Page): Promise<string> {
  try {
    // Wait for page to fully load
    await targetPage.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await targetPage.waitForTimeout(2000); // Give extra time for dynamic content

    // First, remove all irrelevant elements from the page
    await targetPage.evaluate(() => {
      // Comprehensive list of elements to remove
      const selectorsToRemove = [
        // Navigation and structure
        "nav", "header", "footer", "aside",
        "[class*='nav']", "[class*='header']", "[class*='footer']",
        "[class*='sidebar']", "[class*='menu']", "[class*='navigation']",
        "[id*='nav']", "[id*='header']", "[id*='footer']",
        
        // Banners and modals
        "[class*='cookie']", "[class*='banner']", "[class*='modal']",
        "[class*='popup']", "[class*='overlay']", "[class*='dialog']",
        "[id*='cookie']", "[id*='banner']", "[id*='modal']",
        
        // Social and sharing
        "[class*='social']", "[class*='share']", "[class*='follow']",
        "[class*='linkedin']", "[class*='twitter']", "[class*='facebook']",
        
        // Forms and buttons (except apply buttons which might be in the description)
        "form", "button[type='submit']", "[class*='form']",
        
        // Ads and tracking
        "[class*='ad']", "[class*='advertisement']", "[id*='ad']",
        "[class*='tracking']", "[class*='analytics']",
        
        // Common irrelevant sections
        "[class*='related']", "[class*='similar']", "[class*='recommended']",
        "[class*='breadcrumb']", "[class*='pagination']",
      ];
      
      selectorsToRemove.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => el.remove());
        } catch (e) {
          // Ignore errors for invalid selectors
        }
      });
    });

    // Priority selectors for job descriptions (most specific first)
    const prioritySelectors = [
      // Job-specific containers (highest priority)
      "[class*='job-description']",
      "[id*='job-description']",
      "[class*='jobDescription']",
      "[data-testid*='description']",
      "[data-cy*='description']",
      
      // Common job board patterns
      "[class*='job-details']",
      "[class*='job-content']",
      "[class*='position-description']",
      "[class*='role-description']",
      
      // Greenhouse.io specific
      "[id='content']",
      "[class*='content']:not([class*='nav']):not([class*='footer'])",
      
      // Lever specific
      "[class*='description-text']",
      "[class*='posting-description']",
      
      // Workday specific
      "[class*='jobPosting']",
      "[data-automation-id*='jobPosting']",
      
      // Generic but still relevant
      "article[class*='job']",
      "section[class*='job']",
      "div[class*='job']:not([class*='card']):not([class*='list'])",
    ];

    let descriptionText = "";
    let bestMatch = { text: "", length: 0, selector: "" };

    // Strategy 1: Try priority selectors and find the best match
    for (const selector of prioritySelectors) {
      try {
        const elements = await targetPage.locator(selector).all();
        for (const element of elements) {
          const text = await element.innerText().catch(() => "");
          if (text && text.length > bestMatch.length) {
            // Quality check: does it look like a job description?
            const lowerText = text.toLowerCase();
            const hasJobKeywords = 
              lowerText.includes("responsibilities") ||
              lowerText.includes("requirements") ||
              lowerText.includes("qualifications") ||
              lowerText.includes("experience") ||
              lowerText.includes("skills") ||
              lowerText.includes("about") ||
              lowerText.includes("role") ||
              lowerText.includes("position");
            
            // Reject if it's clearly not a job description
            const isIrrelevant = 
              lowerText.includes("cookie policy") ||
              lowerText.includes("privacy policy") ||
              lowerText.includes("terms of service") ||
              lowerText.includes("follow us on") ||
              lowerText.length < 200; // Too short
            
            if (hasJobKeywords && !isIrrelevant && text.length > bestMatch.length) {
              bestMatch = { text: text.trim(), length: text.length, selector };
            }
          }
        }
      } catch (e) {
        // Try next selector
      }
    }

    if (bestMatch.text && bestMatch.length > 300) {
      descriptionText = bestMatch.text;
      console.log(`  ✓ Found description using selector: ${bestMatch.selector} (${bestMatch.length} chars)`);
    }

    // Strategy 2: If no good match, try extracting from main/article with smart filtering
    if (!descriptionText || descriptionText.length < 300) {
      try {
        // Try main content areas but be more selective
        const mainSelectors = [
          "main article",
          "main section",
          "article[class*='content']",
          "[role='main'] article",
          "[role='main'] section",
        ];

        for (const selector of mainSelectors) {
          try {
            const element = targetPage.locator(selector).first();
            const count = await element.count();
            if (count > 0) {
              const text = await element.innerText().catch(() => "");
              if (text && text.length > 300) {
                // Check quality
                const lowerText = text.toLowerCase();
                const jobKeywordCount = [
                  "responsibilities", "requirements", "qualifications",
                  "experience", "skills", "about", "role", "position"
                ].filter(kw => lowerText.includes(kw)).length;
                
                if (jobKeywordCount >= 2) {
                  descriptionText = text.trim();
                  console.log(`  ✓ Found description from main content (${descriptionText.length} chars)`);
                  break;
                }
              }
            }
          } catch (e) {
            // Continue
          }
        }
      } catch (e) {
        // Ignore
      }
    }

    // Strategy 3: Smart text extraction and cleaning
    if (descriptionText) {
      // Clean the text
      descriptionText = descriptionText
        .replace(/\s+/g, " ") // Normalize whitespace
        .replace(/\n{3,}/g, "\n\n") // Max 2 consecutive newlines
        .trim();
      
      // Find the actual job description boundaries
      const lines = descriptionText.split(/\n/).filter(line => line.trim().length > 0);
      let startIdx = 0;
      let endIdx = lines.length;
      
      // Find start: look for job description indicators
      const startKeywords = [
        "job description", "about the role", "about this role",
        "position overview", "role overview", "the role",
        "responsibilities", "key responsibilities"
      ];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        if (startKeywords.some(kw => line.includes(kw))) {
          startIdx = i;
          break;
        }
      }
      
      // Find end: look for application/contact sections
      const endKeywords = [
        "apply now", "apply for this", "how to apply",
        "contact us", "equal opportunity", "eoe",
        "we are an equal", "diversity and inclusion"
      ];
      
      for (let i = startIdx + 1; i < lines.length; i++) {
        const line = lines[i].toLowerCase();
        if (endKeywords.some(kw => line.includes(kw))) {
          // Check if this is actually the end (not just a mention)
          if (line.length < 100 || line.match(/apply|contact|equal/i)) {
            endIdx = i;
            break;
          }
        }
      }
      
      // Extract the relevant section
      if (startIdx < endIdx) {
        const extracted = lines.slice(startIdx, endIdx).join("\n").trim();
        if (extracted.length > 200) {
          descriptionText = extracted;
          console.log(`  ✓ Extracted description section (${descriptionText.length} chars)`);
        }
      }
      
      // Final quality check: remove common irrelevant patterns
      const irrelevantPatterns = [
        /cookie\s+preferences?/i,
        /privacy\s+policy/i,
        /terms\s+of\s+service/i,
        /follow\s+us\s+on/i,
        /connect\s+with\s+us/i,
        /©\s+\d{4}/, // Copyright
        /all\s+rights\s+reserved/i,
      ];
      
      for (const pattern of irrelevantPatterns) {
        descriptionText = descriptionText.replace(pattern, "").trim();
      }
    }

    // Final validation: ensure we have a substantial, quality description
    if (descriptionText && descriptionText.length >= 300) {
      const lowerText = descriptionText.toLowerCase();
      const hasJobContent = 
        lowerText.includes("responsibilities") ||
        lowerText.includes("requirements") ||
        lowerText.includes("qualifications") ||
        lowerText.includes("experience") ||
        (lowerText.includes("skills") && lowerText.length > 500);
      
      if (hasJobContent) {
        return descriptionText;
      }
    }

    console.warn("  ⚠️  Could not extract substantial job description");
    return "";
  } catch (e) {
    console.warn(`  ⚠️  Error extracting job description: ${e}`);
    return "";
  }
}

async function clickApplyAndCaptureUrl(context: BrowserContext, page: Page, card: any): Promise<{ url: string; description: string } | null> {
  // Scroll the card into view first - this is critical
  try {
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000); // Give it time to fully render
  } catch (e) {
    console.warn("Could not scroll card into view, continuing anyway...");
  }
  
  // Try multiple selectors for the apply button - order matters
  // Based on actual HTML: button with class "index_apply-button_Ra0JM" and "ant-btn-primary"
  let applyButton: any = null;
  
  // PRIORITY 1: Class-based selectors (most reliable from actual HTML structure)
  const classBasedSelectors = [
    "button[class*='index_apply-button']",  // Most specific - from actual HTML
    "button[class*='apply-button']",       // Generic apply-button class
    "button.ant-btn-primary",               // Ant Design primary button
    "button[class*='ant-btn'][class*='primary']", // Ant Design button with primary
  ];
  
  for (const selector of classBasedSelectors) {
    try {
      const btn = card.locator(selector).first();
      const count = await btn.count();
      if (count > 0) {
        const isVisible = await btn.isVisible().catch(() => false);
        const boundingBox = await btn.boundingBox().catch(() => null);
        const text = await btn.innerText().catch(() => "");
        
        if (isVisible || boundingBox) {
          // Verify it has "apply" text
          if (text && /apply/i.test(text)) {
            applyButton = btn;
            break;
          }
        }
      }
    } catch (e) {
      // Try next selector
    }
  }
  
  // PRIORITY 2: Try specific text patterns (text is in a span inside button)
  if (!applyButton) {
    const specificTexts = [
      "Apply with autofill",
      "Apply with Autofill",
      "APPLY WITH AUTOFILL",
      "Apply now",
      "Apply Now",
      "APPLY NOW",
      "Apply",
      "APPLY",
    ];
    
    for (const text of specificTexts) {
      try {
        // Try button (Playwright's :has-text() checks child elements including spans)
        const btn = card.locator(`button:has-text("${text}")`).first();
        const count = await btn.count();
        if (count > 0) {
          const isVisible = await btn.isVisible().catch(() => false);
          const boundingBox = await btn.boundingBox().catch(() => null);
          if (isVisible || boundingBox) {
            applyButton = btn;
            break;
          }
        }
        
        // Try link
        const link = card.locator(`a:has-text("${text}")`).first();
        const linkCount = await link.count();
        if (linkCount > 0) {
          const isVisible = await link.isVisible().catch(() => false);
          const boundingBox = await link.boundingBox().catch(() => null);
          if (isVisible || boundingBox) {
            applyButton = link;
            break;
          }
        }
      } catch (e) {
        // Try next text
      }
    }
  }
  
  // PRIORITY 3: Fallback - try regex-based selectors
  if (!applyButton) {
    const buttonSelectors = [
      "button:has-text(/apply.*autofill/i)",
      "button:has-text(/apply.*now/i)",
      "button:has-text(/apply/i)",
      "a:has-text(/apply.*autofill/i)",
      "a:has-text(/apply.*now/i)",
      "a:has-text(/apply/i)",
      "button[class*='ant-btn']:has-text(/apply/i)",
    ];
    
    for (const selector of buttonSelectors) {
      try {
        const button = card.locator(selector).first();
        const count = await button.count();
        if (count > 0) {
          const isVisible = await button.isVisible().catch(() => false);
          const boundingBox = await button.boundingBox().catch(() => null);
          if (isVisible || boundingBox) {
            const btnText = await button.innerText().catch(() => "");
            if (btnText && /apply/i.test(btnText)) {
              applyButton = button;
              break;
            }
          }
        }
      } catch (e) {
        // Try next selector
      }
    }
  }
  
  // Fallback: try getByRole
  if (!applyButton) {
    try {
      const roleButton = card.getByRole("button", { name: /apply/i }).first();
      const count = await roleButton.count();
      if (count > 0) {
        const isVisible = await roleButton.isVisible().catch(() => false);
        const boundingBox = await roleButton.boundingBox().catch(() => null);
        if (isVisible || boundingBox) {
          applyButton = roleButton;
        }
      }
    } catch (e) {
      // Ignore
    }
  }
  
  // Last resort: find any button/link with "apply" text
  if (!applyButton) {
    try {
      const allButtons = card.locator("button, a, [role='button']");
      const count = await allButtons.count();
      for (let i = 0; i < Math.min(count, 10); i++) {
        const btn = allButtons.nth(i);
        const text = await btn.innerText().catch(() => "");
        if (text && /apply/i.test(text)) {
          const isVisible = await btn.isVisible().catch(() => false);
          const boundingBox = await btn.boundingBox().catch(() => null);
          if (isVisible || boundingBox) {
            applyButton = btn;
            break;
          }
        }
      }
    } catch (e) {
      // Ignore
    }
  }
  
  if (!applyButton) {
    console.warn("  ⚠️  No apply button found for this card");
    return null;
  }

  // Wait for button to be visible and enabled
  try {
    await applyButton.waitFor({ state: 'visible', timeout: 5000 });
    // Also wait for it to be stable (not animating)
    await page.waitForTimeout(500);
  } catch (e) {
    console.warn("  ⚠️  Button not visible, will try force click...");
  }

  // Get current URL before clicking
  const urlBeforeClick = page.url();
  
  // Try to click the button
  let clicked = false;
  try {
    // Wait for new page event with longer timeout
    const pagePromise = context.waitForEvent("page", { timeout: 8000 }).catch(() => null);
    
    // Click the button
    await applyButton.click({ timeout: 15000 });
    clicked = true;
    
    // Wait a bit to see if navigation happens
    await page.waitForTimeout(1500);
    
    // Check if a new page was opened
    const maybeNewPage = await pagePromise;
    
    let targetPage = page;
    if (maybeNewPage) {
      targetPage = maybeNewPage;
      console.log("  📄 New tab opened");
      await targetPage.waitForLoadState("domcontentloaded").catch(() => {});
      await targetPage.waitForTimeout(1000);
    } else {
      // Check if current page navigated
      await page.waitForTimeout(2000);
      const urlAfterClick = page.url();
      if (urlAfterClick !== urlBeforeClick && !urlAfterClick.includes("jobright.ai")) {
        // Same-page navigation to external site
        targetPage = page;
        console.log("  🔄 Same-page navigation detected");
      }
    }

    const url = targetPage.url();
    
    // Heuristic: ignore Jobright URLs, only keep external application URLs.
    if (url.includes("jobright.ai")) {
      console.warn("  ⚠️  Still on Jobright, click may not have worked");
      // Still try to dismiss modal in case it appeared
      await dismissApplyModal(page);
      if (targetPage !== page) {
        await targetPage.close().catch(() => {});
      }
      return null;
    }

    // Extract job description from the external page BEFORE closing it
    console.log("  📝 Extracting job description...");
    const description = await extractJobDescription(targetPage);
    
    if (targetPage !== page) {
      await targetPage.close().catch(() => {});
      // After closing external tab, return to Jobright page and dismiss any modal
      await page.bringToFront();
      await page.waitForTimeout(500);
      await dismissApplyModal(page);
    }

    return { url, description };
  } catch (e: any) {
    if (!clicked) {
      // If normal click failed, try force click
      console.warn("  ⚠️  Normal click failed, trying force click...");
      try {
        const urlBeforeForce = page.url();
        const pagePromise = context.waitForEvent("page", { timeout: 8000 }).catch(() => null);
        
        await applyButton.click({ force: true, timeout: 15000 });
        await page.waitForTimeout(1500);
        
        const maybeNewPage = await pagePromise;
        
        let targetPage = page;
        if (maybeNewPage) {
          targetPage = maybeNewPage;
          console.log("  📄 New tab opened (force click)");
          await targetPage.waitForLoadState("domcontentloaded").catch(() => {});
          await targetPage.waitForTimeout(1000);
        } else {
          await page.waitForTimeout(2000);
          const urlAfterForce = page.url();
          if (urlAfterForce !== urlBeforeForce && !urlAfterForce.includes("jobright.ai")) {
            targetPage = page;
            console.log("  🔄 Same-page navigation (force click)");
          }
        }

        const url = targetPage.url();
        
        if (url.includes("jobright.ai")) {
          console.warn("  ⚠️  Still on Jobright after force click");
          await dismissApplyModal(page);
          if (targetPage !== page) {
            await targetPage.close().catch(() => {});
          }
          return null;
        }

        // Extract job description from the external page BEFORE closing it
        console.log("  📝 Extracting job description...");
        const description = await extractJobDescription(targetPage);
        
        if (targetPage !== page) {
          await targetPage.close().catch(() => {});
          await page.bringToFront();
          await page.waitForTimeout(500);
          await dismissApplyModal(page);
        }

        return { url, description };
      } catch (e2: any) {
        console.warn(`  ❌ Failed to click apply button: ${e2.message}`);
        return null;
      }
    }
    console.warn(`  ❌ Click error: ${e.message}`);
    return null;
  }
}

// Save job description to database
async function saveJobDescription(jobApplicationId: number, description: string) {
  try {
    // Check if description already exists
    const existing = await prisma.jobDescription.findUnique({
      where: { jobApplicationId },
    });

    if (existing) {
      // Update existing description
      await prisma.jobDescription.update({
        where: { jobApplicationId },
        data: { fullText: description },
      });
      console.log(`  ✅ Updated job description (${description.length} chars)`);
    } else {
      // Create new description
      await prisma.jobDescription.create({
        data: {
          jobApplicationId,
          fullText: description,
          source: "company_site",
        },
      });
      console.log(`  ✅ Saved job description (${description.length} chars)`);
    }
  } catch (error: any) {
    console.error(`  ❌ Error saving job description: ${error.message}`);
  }
}

async function ensureUserExists(userId: number): Promise<number> {
  // First, try to find user with the requested id
  let user = await prisma.user.findUnique({
    where: { id: userId },
  });
  
  if (!user) {
    // If not found, try to find any existing user
    user = await prisma.user.findFirst();
    
    if (!user) {
      // No users exist, create a default one
      console.log(`No users found. Creating default user...`);
      user = await prisma.user.create({
        data: {
          email: `user@jobbot.local`,
          passwordHash: 'dummy', // Not used since we're not implementing auth
        },
      });
      console.log(`✅ User created with id ${user.id}\n`);
    } else {
      console.log(`User with id ${userId} not found. Using existing user with id ${user.id}\n`);
    }
  }
  
  return user.id;
}

async function main() {
  console.log(`\n🔍 Jobright Scanner\n`);
  console.log(`Using persistent context directory: ${PERSISTENT_CONTEXT_DIR}`);
  
  // Ensure user exists and get the actual user id to use
  const actualUserId = await ensureUserExists(USER_ID);
  
  // Check if context directory exists and has cookies
  if (!fs.existsSync(PERSISTENT_CONTEXT_DIR)) {
    console.error(`\n❌ ERROR: Context directory does not exist: ${PERSISTENT_CONTEXT_DIR}`);
    console.error(`Please run: npm run jobright:login first\n`);
    process.exit(1);
  }
  
  // Check for cookies (they're stored in a subdirectory)
  const cookiesPath = path.join(PERSISTENT_CONTEXT_DIR, 'Default', 'Cookies');
  if (!fs.existsSync(cookiesPath) && !fs.existsSync(path.join(PERSISTENT_CONTEXT_DIR, 'Cookies'))) {
    console.warn(`⚠️  Warning: No cookies found. You may need to log in first.`);
    console.warn(`Run: npm run jobright:login\n`);
  } else {
    console.log(`✅ Found saved cookies in context directory\n`);
  }
  
  const context = await chromium.launchPersistentContext(PERSISTENT_CONTEXT_DIR, {
    headless: false,
    timeout: 60000,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });

  const page = await context.newPage();
  
  // Hide automation indicators
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
    });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
  });
  
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });
  
  await ensureLoggedIn(page);

  let processedCount = 0;
  let skippedCount = 0;
  let cardIndex = 0;
  let consecutiveSkips = 0; // Track consecutive cards without buttons
  const maxAttempts = MAX_JOBS_PER_RUN * 5; // Allow more attempts to find valid cards
  const processedJobs = new Set<string>(); // Track processed title+company combinations

  for (let attempt = 0; attempt < maxAttempts && processedCount < MAX_JOBS_PER_RUN; attempt++) {
    // Make sure we're on the Jobright page and dismiss any modals
    await page.bringToFront();
    if (!page.url().includes("jobright.ai/jobs/recommend")) {
      await page.goto(JOBRIGHT_RECOMMEND_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000); // Wait for cards to load
    }
    await dismissApplyModal(page);
    
    // Refresh card list each time to avoid stale references
    const cards = await getJobCards(page);
    if (cards.length === 0) {
      console.warn("No cards found, waiting and retrying...");
      await page.waitForTimeout(2000);
      continue;
    }
    
    // If we've reached the end, try scrolling to load more cards
    if (cardIndex >= cards.length) {
      console.log(`Reached end of visible cards. Scrolling to load more...`);
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(2000);
      // Reset to check new cards
      cardIndex = Math.max(0, cards.length - 10); // Start a bit before the end
      consecutiveSkips = 0; // Reset skip counter
      continue;
    }
    
    // If we've skipped many cards in a row, skip ahead more aggressively or scroll
    if (consecutiveSkips >= 5) {
      if (consecutiveSkips >= 10) {
        // After 10 consecutive skips, scroll down to load more cards
        console.log(`  📜 Scrolling to load more cards (${consecutiveSkips} consecutive skips)...`);
        await page.evaluate(() => {
          window.scrollBy(0, 1000);
        });
        await page.waitForTimeout(1500);
        // Refresh cards after scrolling
        const newCards = await getJobCards(page);
        if (newCards.length > cards.length) {
          console.log(`  ✅ Loaded more cards: ${cards.length} → ${newCards.length}`);
          cardIndex = cards.length; // Start from where we left off
          consecutiveSkips = 0;
          continue;
        }
      } else {
        // Skip ahead 3 cards at once
        console.log(`  ⏩ Skipping ahead 3 cards (${consecutiveSkips} consecutive skips)...`);
        cardIndex += 3;
        consecutiveSkips = 0;
        continue;
      }
    }
    
    const card = cards[cardIndex];
    
    // Scroll card into view first - buttons may be lazy-loaded
    try {
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500); // Wait for buttons to render (reduced for speed)
    } catch (e) {
      // Continue anyway
    }
    
    // DEBUG: Extract basic card info for logging
    let cardTitle = "";
    let cardCompany = "";
    try {
      cardTitle = await card.locator("h2, h3").first().innerText().catch(() => "");
      const companySelectors = ["[class*='company-name']", "div[class*='company']"];
      for (const sel of companySelectors) {
        const companyEl = card.locator(sel).first();
        const count = await companyEl.count();
        if (count > 0) {
          cardCompany = await companyEl.innerText().catch(() => "");
          if (cardCompany) break;
        }
      }
    } catch (e) {
      // Ignore
    }
    
    // Check: does this card have an apply button before extracting metadata?
    let hasApplyButton = false;
    let foundButtonText = "";
    const debugButtons: Array<{text: string, type: string, visible: boolean, hasBoundingBox: boolean}> = [];
    
    try {
      // First, collect ALL buttons/links in the card for debugging
      const allButtons = card.locator("button, a, [role='button']");
      const btnCount = await allButtons.count();
      console.log(`\n[Card ${cardIndex + 1}/${cards.length}] DEBUG: Found ${btnCount} buttons/links`);
      if (cardTitle) console.log(`  📋 Title: "${cardTitle}"`);
      if (cardCompany) console.log(`  🏢 Company: "${cardCompany}"`);
      
      // Log all buttons found
      for (let i = 0; i < Math.min(btnCount, 15); i++) {
        try {
          const btn = allButtons.nth(i);
          const text = await btn.innerText().catch(() => "");
          const tagName = await btn.evaluate(el => el.tagName.toLowerCase()).catch(() => "unknown");
          const isVisible = await btn.isVisible().catch(() => false);
          const boundingBox = await btn.boundingBox().catch(() => null);
          const className = await btn.evaluate(el => el.className).catch(() => "");
          
          debugButtons.push({
            text: text.trim() || "(empty)",
            type: tagName,
            visible: isVisible,
            hasBoundingBox: !!boundingBox
          });
          
          if (text && /apply/i.test(text)) {
            console.log(`  🔘 Button ${i}: "${text.trim()}" (${tagName}, visible: ${isVisible}, hasBox: ${!!boundingBox}, class: ${className.substring(0, 50)})`);
          }
        } catch (e) {
          // Continue
        }
      }
      
      // PRIORITY 1: Try class-based selectors first (most reliable based on actual HTML structure)
      // The button has class "index_apply-button_Ra0JM" and "ant-btn-primary"
      const classBasedSelectors = [
        "button[class*='index_apply-button']",  // Most specific - from the actual HTML
        "button[class*='apply-button']",       // Generic apply-button class
        "button.ant-btn-primary",              // Ant Design primary button
        "button[class*='ant-btn'][class*='primary']", // Ant Design button with primary
      ];
      
      for (const selector of classBasedSelectors) {
        try {
          const btn = card.locator(selector).first();
          const count = await btn.count();
          if (count > 0) {
            const isVisible = await btn.isVisible().catch(() => false);
            const boundingBox = await btn.boundingBox().catch(() => null);
            const text = await btn.innerText().catch(() => "");
            
            if (isVisible || boundingBox) {
              // Verify it has "apply" text (to avoid false positives)
              if (text && /apply/i.test(text)) {
                hasApplyButton = true;
                foundButtonText = text.trim();
                console.log(`  ✅ Found button with class selector "${selector}": "${text.trim()}" (visible: ${isVisible}, hasBox: ${!!boundingBox})`);
                break;
              } else {
                console.log(`  ⚠️  Found button with class "${selector}" but text doesn't match: "${text}"`);
              }
            }
          }
        } catch (e) {
          // Try next selector
        }
      }
      
      // PRIORITY 2: Try specific text patterns (text is in a span inside button)
      if (!hasApplyButton) {
        const specificTexts = [
          "Apply with autofill",
          "Apply with Autofill",
          "APPLY WITH AUTOFILL",
          "Apply now",
          "Apply Now",
          "APPLY NOW",
          "Apply",
          "APPLY",
        ];
        
        for (const text of specificTexts) {
          try {
            // Try button with text (Playwright's :has-text() checks child elements including spans)
            const btn = card.locator(`button:has-text("${text}")`).first();
            const count = await btn.count();
            if (count > 0) {
              const isVisible = await btn.isVisible().catch(() => false);
              const boundingBox = await btn.boundingBox().catch(() => null);
              if (isVisible || boundingBox) {
                hasApplyButton = true;
                foundButtonText = text;
                console.log(`  ✅ Found button with exact text: "${text}" (visible: ${isVisible}, hasBox: ${!!boundingBox})`);
                break;
              } else {
                console.log(`  ⚠️  Found button with text "${text}" but not visible/accessible`);
              }
            }
            
            // Try link
            const link = card.locator(`a:has-text("${text}")`).first();
            const linkCount = await link.count();
            if (linkCount > 0) {
              const isVisible = await link.isVisible().catch(() => false);
              const boundingBox = await link.boundingBox().catch(() => null);
              if (isVisible || boundingBox) {
                hasApplyButton = true;
                foundButtonText = text;
                console.log(`  ✅ Found link with exact text: "${text}" (visible: ${isVisible}, hasBox: ${!!boundingBox})`);
                break;
              }
            }
          } catch (e) {
            // Try next text
          }
        }
      }
      
      // PRIORITY 3: Fallback - try regex-based selectors
      if (!hasApplyButton) {
        const buttonSelectors = [
          "button:has-text(/apply.*autofill/i)",
          "button:has-text(/apply.*now/i)",
          "button:has-text(/apply/i)",
          "a:has-text(/apply.*autofill/i)",
          "a:has-text(/apply.*now/i)",
          "a:has-text(/apply/i)",
          "button[class*='ant-btn']:has-text(/apply/i)",
        ];
        
        for (const selector of buttonSelectors) {
          try {
            const quickCheck = card.locator(selector).first();
            const count = await quickCheck.count();
            if (count > 0) {
              const isVisible = await quickCheck.isVisible().catch(() => false);
              const boundingBox = await quickCheck.boundingBox().catch(() => null);
              if (isVisible || boundingBox) {
                const text = await quickCheck.innerText().catch(() => "");
                if (text && /apply/i.test(text)) {
                  hasApplyButton = true;
                  foundButtonText = text.trim();
                  console.log(`  ✅ Found button with selector "${selector}": "${text.trim()}"`);
                  break;
                }
              }
            }
          } catch (e) {
            // Try next selector
          }
        }
      }
      
      // Last resort: check ALL buttons/links in the card for "apply" text
      if (!hasApplyButton) {
        for (let i = 0; i < Math.min(btnCount, 15); i++) {
          try {
            const btn = allButtons.nth(i);
            const text = await btn.innerText().catch(() => "");
            if (text && /apply/i.test(text)) {
              const isVisible = await btn.isVisible().catch(() => false);
              const boundingBox = await btn.boundingBox().catch(() => null);
              console.log(`  🔍 Checking button ${i}: "${text.trim()}" (visible: ${isVisible}, hasBox: ${!!boundingBox})`);
              if (isVisible || boundingBox) {
                hasApplyButton = true;
                foundButtonText = text.trim();
                console.log(`  ✅ Accepted button: "${text.trim()}"`);
                break;
              } else {
                console.log(`  ❌ Rejected button "${text.trim()}" - not visible and no bounding box`);
              }
            }
          } catch (e) {
            // Continue to next button
          }
        }
      }
    } catch (e) {
      console.log(`  ❌ Error during button detection: ${e}`);
    }
    
    if (!hasApplyButton) {
      consecutiveSkips++;
      console.log(`  ⏭️  SKIPPING: No apply button found (${consecutiveSkips} in a row)`);
      console.log(`  📊 Summary: Checked ${debugButtons.length} buttons, none matched criteria`);
      cardIndex++;
      skippedCount++;
      continue;
    }
    
    // Reset skip counter when we find a valid card
    consecutiveSkips = 0;
    
    console.log(`\n[Card ${cardIndex + 1}/${cards.length}] Processing... (Found button: "${foundButtonText}")`);
    
    const meta = await extractCardMetadata(card);
    
    // Skip jobs with low match score
    if (typeof meta.matchScore === "number" && !isNaN(meta.matchScore) && meta.matchScore < MATCH_SCORE_THRESHOLD) {
      console.log(`  ⏭️  Skipping due to low match score: ${meta.matchScore}% < ${MATCH_SCORE_THRESHOLD}%`);
      cardIndex++;
      skippedCount++;
      continue;
    }
    
    // Check if we've already processed this job (by title + company)
    const jobKey = `${meta.title}|||${meta.company}`.toLowerCase();
    if (processedJobs.has(jobKey)) {
      console.log(`  ⏭️  Already processed: ${meta.title} at ${meta.company}`);
      cardIndex++;
      skippedCount++;
      continue;
    }
    
    // Mark as processed to avoid re-processing
    processedJobs.add(jobKey);

    const result = await clickApplyAndCaptureUrl(context, page, card);
    
    // Always move to next card after attempting to process
    cardIndex++;
    
    if (!result) {
      // Still try to dismiss modal even if we didn't get a URL
      await dismissApplyModal(page);
      skippedCount++;
      console.log(`  ⏭️  Skipped: Could not capture URL`);
      await page.waitForTimeout(500);
      continue;
    }

    const { url: applyUrl, description } = result;

    // Skip LinkedIn URLs
    if (applyUrl.toLowerCase().includes("linkedin.com")) {
      console.log(`  ⏭️  Skipping LinkedIn URL: ${applyUrl}`);
      await dismissApplyModal(page);
      skippedCount++;
      await page.waitForTimeout(500);
      continue;
    }

    console.log(`  ✅ Captured apply URL: ${applyUrl}`);
    if (description) {
      console.log(`  ✅ Captured job description: ${description.length} characters`);
    } else {
      console.log(`  ⚠️  No job description captured`);
    }

    // Check for duplicate in database by title + company before saving
    const existing = await prisma.jobApplication.findFirst({
      where: {
        title: meta.title,
        company: meta.company,
      },
    });

    if (existing) {
      console.log(`  ⏭️  Skipping duplicate in DB: ${meta.title} at ${meta.company}`);
      await dismissApplyModal(page);
      skippedCount++;
      await page.waitForTimeout(500);
      continue;
    }

    try {
      const savedJob = await upsertJobApplication({
        userId: actualUserId,
        title: meta.title,
        company: meta.company,
        location: meta.location,
        externalUrl: applyUrl,
        jobrightBoard: "recommended",
        jobrightMatchScore: meta.matchScore,
      });
      processedCount++;
      console.log(`  ✅ Saved: ${meta.title} at ${meta.company}`);
      
      // Save job description if we captured one
      if (description && description.length > 0) {
        await saveJobDescription(savedJob.id, description);
        console.log(`  ✅ Job description saved (${description.length} chars)`);
        
        // Auto-generate resume and cover letter if enabled
        console.log(`  📋 AUTO_GENERATE_DOCUMENTS: ${AUTO_GENERATE_DOCUMENTS} (env: ${process.env.AUTO_GENERATE_DOCUMENTS})`);
        if (AUTO_GENERATE_DOCUMENTS) {
          // Only generate if description is substantial (at least 300 chars)
          if (description.length >= 300) {
            try {
              console.log(`  🤖 Generating tailored resume and cover letter for job ${savedJob.id}...`);
              console.log(`     Company: ${meta.company}, Role: ${meta.title}`);
              const result = await generateResumeAndCoverLetter(savedJob.id, {
                model: process.env.OPENAI_MODEL || "gpt-4",
                outputDir: process.env.RESUMES_OUTPUT_DIR || "Resumes",
                saveToDatabase: true,
              });
              console.log(`  ✅ Documents generated successfully:`);
              console.log(`     Resume: ${result.resumePath}`);
              console.log(`     Cover Letter: ${result.coverLetterPath}`);
            } catch (error: any) {
              console.error(`  ❌ Failed to generate documents: ${error.message}`);
              if (error.stack) {
                console.error(`     Stack: ${error.stack.split('\n').slice(0, 5).join('\n')}`);
              }
              // Don't fail the entire scan if document generation fails
            }
          } else {
            console.log(`  ⚠️  Job description too short (${description.length} chars), skipping document generation (need >= 300)`);
          }
        } else {
          console.log(`  ⏭️  Document generation is disabled (AUTO_GENERATE_DOCUMENTS=false)`);
        }
      } else {
        console.log(`  ⚠️  No job description captured, skipping document generation`);
      }
      
      // After successfully processing a job and clicking "Yes, I applied!", 
      // refresh the page to get updated job list (the applied job will be removed)
      console.log(`  🔄 Refreshing recommended page...`);
      await page.goto(JOBRIGHT_RECOMMEND_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000); // Wait for cards to load
      
      // Reset card index to start from the beginning after refresh
      cardIndex = 0;
      console.log(`  ✅ Page refreshed, starting from first card`);
    } catch (error: any) {
      console.error(`  ❌ Error saving job: ${error.message}`);
      skippedCount++;
    }
    
    // Small delay before next iteration
    await page.waitForTimeout(500);
  }
  
  console.log(`\n✅ Scan complete! Processed: ${processedCount}, Skipped: ${skippedCount}`);

  await context.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

