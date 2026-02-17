import { chromium, BrowserContext, Page } from "playwright";
import * as path from "path";

// Copy the extractJobDescription function from jobrightScan.ts
async function extractJobDescription(targetPage: Page): Promise<string> {
  try {
    // Wait for page to fully load
    await targetPage.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await targetPage.waitForTimeout(3000); // Give extra time for dynamic content to render

    // Dismiss cookie/privacy modals that might block content
    try {
      const cookieModalSelectors = [
        "button:has-text('Accept')",
        "button:has-text('I Accept')",
        "button:has-text('Accept All')",
        "button:has-text('Reject All')",
        "button:has-text('Save & Exit')",
        "[class*='cookie'] button",
        "[id*='cookie'] button",
        "[class*='privacy'] button",
        "[id*='privacy'] button",
        "button[aria-label*='Accept']",
        "button[aria-label*='Cookie']",
      ];
      
      for (const selector of cookieModalSelectors) {
        try {
          const button = targetPage.locator(selector).first();
          const count = await button.count();
          if (count > 0) {
            const isVisible = await button.isVisible().catch(() => false);
            if (isVisible) {
              console.log(`  🍪 Dismissing cookie/privacy modal...`);
              await button.click({ timeout: 5000 });
              await targetPage.waitForTimeout(1000);
              break;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
    } catch (e) {
      // Not critical, continue
    }

    // General strategy: Try to expand any collapsed content sections
    // This works for any site that uses "Show more", "Read more", etc.
    try {
      const expandSelectors = [
        "button:has-text('Show more')",
        "button:has-text('Read more')",
        "button:has-text('See more')",
        "button:has-text('Expand')",
        "[aria-expanded='false']",
        "button[class*='expand']",
        "button[class*='more']",
      ];
      
      for (const selector of expandSelectors) {
        try {
          const expandButtons = targetPage.locator(selector);
          const count = await expandButtons.count();
          if (count > 0) {
            console.log(`  🔍 Found ${count} potentially collapsed sections, attempting to expand...`);
            // Try to expand first few buttons (don't expand all to avoid issues)
            for (let i = 0; i < Math.min(count, 3); i++) {
              try {
                await expandButtons.nth(i).click({ timeout: 3000 });
                await targetPage.waitForTimeout(500);
              } catch (e) {
                // Continue with next
              }
            }
          }
        } catch (e) {
          // Continue with next selector
        }
      }
    } catch (e) {
      // Not critical, continue
    }

    // Special handling for tabbed interfaces (like AshbyHQ)
    try {
      const tabs = targetPage.locator("[role='tab']");
      const tabCount = await tabs.count();
      if (tabCount > 0) {
        // Look for tabs that might contain the description (Overview, Description, Details, etc.)
        const descriptionTabNames = ["overview", "description", "details", "about", "role"];
        for (const tabName of descriptionTabNames) {
          try {
            const tab = targetPage.getByRole("tab", { name: new RegExp(tabName, "i") });
            const count = await tab.count();
            if (count > 0) {
              const firstTab = tab.first();
              const ariaSelected = await firstTab.getAttribute("aria-selected").catch(() => null);
              if (ariaSelected !== "true") {
                console.log(`  👉 Clicking "${tabName}" tab to view description...`);
                await firstTab.click({ timeout: 5000 });
                await targetPage.waitForTimeout(1500);
                break; // Found and clicked a relevant tab
              }
            }
          } catch (e) {
            // Continue
          }
        }
      }
    } catch (e) {
      // Not critical, continue
    }

    // Save body text BEFORE removing elements (for Strategy 4 fallback)
    let savedBodyText = "";
    try {
      savedBodyText = await targetPage.locator("body").innerText().catch(() => "");
      console.log(`  💾 Saved body text for fallback: ${savedBodyText.length} chars`);
    } catch (e) {
      // Ignore
    }

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
    // These are general patterns that work across many job sites
    const prioritySelectors = [
      // Job-specific containers (highest priority)
      "[class*='job-description']",
      "[id*='job-description']",
      "[class*='jobDescription']",
      "[class*='JobDescription']",
      "[data-testid*='description']",
      "[data-cy*='description']",
      "[data-testid*='job-description']",
      
      // Common job board patterns
      "[class*='job-details']",
      "[class*='job-content']",
      "[class*='job-content']",
      "[class*='position-description']",
      "[class*='role-description']",
      "[class*='posting-description']",
      "[class*='description-text']",
      "[class*='description-content']",
      
      // Career/job posting pages (like Plex, Greenhouse, etc.)
      "[class*='career']",
      "[class*='careers']",
      "[id*='career']",
      "[class*='job-overview']",
      "[class*='job-overview']",
      "h1:has-text('Engineer'), h1:has-text('Developer'), h1:has-text('Manager')",
      
      // Content containers
      "[id='content']",
      "[class*='content']:not([class*='nav']):not([class*='footer']):not([class*='header'])",
      "[class*='main-content']",
      "[class*='page-content']",
      
      // Job posting containers
      "[class*='jobPosting']",
      "[class*='job-posting']",
      "[data-automation-id*='jobPosting']",
      "[class*='posting']",
      
      // Generic but still relevant
      "article[class*='job']",
      "section[class*='job']",
      "div[class*='job']:not([class*='card']):not([class*='list']):not([class*='item'])",
      "article[class*='description']",
      "section[class*='description']",
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
              lowerText.includes("position") ||
              lowerText.includes("what you'll") ||
              lowerText.includes("what you will") ||
              lowerText.includes("we are looking") ||
              lowerText.includes("looking for");
            
            // Reject if it's clearly not a job description
            const isIrrelevant = 
              lowerText.includes("cookie policy") ||
              lowerText.includes("privacy policy") ||
              lowerText.includes("terms of service") ||
              lowerText.includes("follow us on") ||
              lowerText.length < 150; // Lower threshold - be more lenient
            
            // Accept if it has job keywords OR if it's substantial text (might be a job description without obvious keywords)
            const isAcceptable = (hasJobKeywords || text.length > 500) && !isIrrelevant;
            
            if (isAcceptable && text.length > bestMatch.length) {
              bestMatch = { text: text.trim(), length: text.length, selector };
            }
          }
        }
      } catch (e) {
        // Try next selector
      }
    }

    // Lower threshold - be more lenient to catch more descriptions
    const minLength = 200;
    if (bestMatch.text && bestMatch.length > minLength) {
      descriptionText = bestMatch.text;
      console.log(`  ✓ Found description using selector: ${bestMatch.selector} (${bestMatch.length} chars)`);
    }

    // Strategy 2: If no good match, try extracting from main/article with smart filtering
    if (!descriptionText || descriptionText.length < minLength) {
      try {
        // Try main content areas but be more selective
        const mainSelectors = [
          "main article",
          "main section",
          "main > div",
          "article[class*='content']",
          "[role='main'] article",
          "[role='main'] section",
          "[role='main']",
          "main",
        ];

        for (const selector of mainSelectors) {
          try {
            const element = targetPage.locator(selector).first();
            const count = await element.count();
            if (count > 0) {
              const text = await element.innerText().catch(() => "");
              if (text && text.length > minLength) {
                // Check quality - be more lenient
                const lowerText = text.toLowerCase();
                const jobKeywordCount = [
                  "responsibilities", "requirements", "qualifications",
                  "experience", "skills", "about", "role", "position",
                  "what you'll", "looking for", "what you bring", "job overview",
                  "who we are", "what sets us apart"
                ].filter(kw => lowerText.includes(kw)).length;
                
                // Accept if has keywords OR if substantial length
                if (jobKeywordCount >= 1 || text.length > 600) {
                  descriptionText = text.trim();
                  console.log(`  ✓ Found description from main content (${descriptionText.length} chars, ${jobKeywordCount} keywords)`);
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

    // Strategy 2.5: Try finding content near job title (for pages like Plex)
    if (!descriptionText || descriptionText.length < minLength) {
      try {
        // Look for h1 or h2 with job title, then get the following content
        const titleSelectors = [
          "h1",
          "h2",
          "[class*='job-title']",
          "[class*='position-title']",
        ];
        
        for (const titleSelector of titleSelectors) {
          try {
            const titleElements = await targetPage.locator(titleSelector).all();
            for (const titleEl of titleElements) {
              const titleText = await titleEl.innerText().catch(() => "");
              // Check if it looks like a job title (contains common job words)
              if (titleText && /engineer|developer|manager|analyst|specialist|director|lead|senior|junior/i.test(titleText)) {
                // Get the parent container that has substantial content
                const parentText = await titleEl.evaluateHandle((el) => {
                  let current = el.parentElement;
                  let bestParent = null;
                  let bestLength = 0;
                  
                  // Check up to 3 levels of parents
                  for (let i = 0; i < 3 && current; i++) {
                    const text = current.innerText || "";
                    if (text.length > bestLength && text.length > 500) {
                      bestLength = text.length;
                      bestParent = current;
                    }
                    current = current.parentElement;
                  }
                  return bestParent ? bestParent.innerText : null;
                }).catch(() => null);
                
                if (parentText) {
                  const text = await parentText.jsonValue().catch(() => "");
                  if (text && text.length > minLength) {
                    const lowerText = text.toLowerCase();
                    const jobKeywordCount = [
                      "responsibilities", "requirements", "qualifications",
                      "experience", "skills", "about", "role", "position",
                      "what you'll", "looking for", "what you bring", "job overview"
                    ].filter(kw => lowerText.includes(kw)).length;
                    
                    if (jobKeywordCount >= 1 || text.length > 600) {
                      descriptionText = text.trim();
                      console.log(`  ✓ Found description near job title (${descriptionText.length} chars, ${jobKeywordCount} keywords)`);
                      break;
                    }
                  }
                }
              }
            }
            if (descriptionText && descriptionText.length > minLength) break;
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
        descriptionText = lines.slice(startIdx, endIdx).join("\n").trim();
      }
    }

    // Strategy 4: Last resort - extract all body text and filter intelligently
    if (!descriptionText || descriptionText.length < minLength) {
      try {
        console.log("  🔍 Trying last resort: extracting all body text...");
        // Use saved body text if available, otherwise try to get it again
        let bodyText = savedBodyText || await targetPage.locator("body").innerText().catch(() => "");
        console.log(`  📊 Body text length: ${bodyText.length} chars`);
        if (bodyText && bodyText.length > 1000) {
          // Filter out navigation, footer, cookie notices, etc.
          const lines = bodyText.split(/\n/).filter(line => {
            const lower = line.toLowerCase().trim();
            // Skip navigation, footer, cookie notices
            if (lower.includes("cookie") || lower.includes("privacy policy") || 
                lower.includes("terms of service") || lower.includes("follow us") ||
                lower.length < 10 || lower.match(/^(home|about|contact|sign in|sign up)$/i)) {
              return false;
            }
            return true;
          });
          console.log(`  📊 Filtered lines: ${lines.length} (from ${bodyText.split(/\n/).length} total)`);
          
          // Find the section that contains job description keywords
          let startIdx = -1;
          let endIdx = lines.length;
          
          for (let i = 0; i < lines.length; i++) {
            const lower = lines[i].toLowerCase();
            // Look for job description start markers
            if (startIdx === -1 && (
              lower.includes("job overview") || lower.includes("about the role") ||
              lower.includes("position overview") || lower.includes("the role") ||
              lower.includes("what you'll") || lower.includes("what you will") ||
              lower.includes("responsibilities") || lower.includes("requirements")
            )) {
              startIdx = i;
            }
            // Look for end markers
            if (startIdx !== -1 && (
              lower.includes("apply now") || lower.includes("how to apply") ||
              lower.includes("equal opportunity") || lower.includes("diversity and inclusion") ||
              (lower.includes("compensation") && i > startIdx + 10) // Compensation section is usually at the end
            )) {
              endIdx = i;
              break;
            }
          }
          
          // If we found a start, extract from there
          console.log(`  🔍 Start index: ${startIdx}, End index: ${endIdx}`);
          if (startIdx !== -1 && endIdx > startIdx) {
            const extracted = lines.slice(startIdx, endIdx).join("\n").trim();
            console.log(`  📝 Extracted length: ${extracted.length} chars`);
            if (extracted.length > minLength) {
              descriptionText = extracted;
              console.log(`  ✓ Found description using body text extraction (${descriptionText.length} chars)`);
            } else {
              console.log(`  ⚠️  Extracted text too short: ${extracted.length} < ${minLength}`);
            }
          } else {
            console.log(`  ⚠️  No start marker found (startIdx: ${startIdx})`);
          }
          
          if (!descriptionText && bodyText.length > 2000) {
            // If no clear markers but substantial text, try to find the main content section
            // Look for the longest continuous section with job keywords
            const jobKeywords = ["engineer", "developer", "experience", "skills", "responsibilities", 
                                "requirements", "qualifications", "role", "position"];
            let bestSection = "";
            let bestScore = 0;
            
            // Split into paragraphs and score each
            const paragraphs = bodyText.split(/\n\s*\n/).filter(p => p.trim().length > 100);
            for (const para of paragraphs) {
              const lower = para.toLowerCase();
              const keywordCount = jobKeywords.filter(kw => lower.includes(kw)).length;
              const score = keywordCount * 100 + para.length;
              if (score > bestScore && para.length > 500) {
                bestScore = score;
                bestSection = para;
              }
            }
            
            if (bestSection.length > minLength) {
              descriptionText = bestSection.trim();
              console.log(`  ✓ Found description using paragraph scoring (${descriptionText.length} chars)`);
            } else {
              console.log(`  ⚠️  Best section too short: ${bestSection.length} < ${minLength}`);
            }
          }
        } else {
          console.log(`  ⚠️  Body text too short: ${bodyText.length} < 1000`);
        }
      } catch (e) {
        console.log(`  ⚠️  Error in Strategy 4: ${e}`);
      }
    }

    // Final validation: ensure we have a substantial, quality description
    // Be more lenient - accept if substantial length OR has job keywords
    const minFinalLength = 200;
    if (descriptionText && descriptionText.length >= minFinalLength) {
      const lowerText = descriptionText.toLowerCase();
      const hasJobContent = 
        lowerText.includes("responsibilities") ||
        lowerText.includes("requirements") ||
        lowerText.includes("qualifications") ||
        lowerText.includes("experience") ||
        lowerText.includes("skills") ||
        lowerText.includes("about") ||
        lowerText.includes("role") ||
        lowerText.includes("position") ||
        lowerText.includes("what you'll") ||
        lowerText.includes("what you will") ||
        lowerText.includes("what you bring") ||
        lowerText.includes("looking for") ||
        lowerText.includes("job overview") ||
        descriptionText.length > 500; // Accept if just long enough
      
      if (hasJobContent) {
        console.log(`  ✅ Extracted description (${descriptionText.length} chars, quality check passed)`);
        return descriptionText;
      } else {
        console.warn(`  ⚠️  Description found (${descriptionText.length} chars) but failed quality check`);
      }
    }

    // Final check - if we still don't have a description
    if (!descriptionText || descriptionText.length < minFinalLength) {
      console.warn(`  ⚠️  Could not extract substantial job description (found ${descriptionText ? descriptionText.length : 0} chars, need ${minFinalLength}+)`);
      return "";
    }

    return descriptionText;
  } catch (e) {
    console.warn(`  ⚠️  Error extracting job description: ${e}`);
    return "";
  }
}

async function main() {
  const testUrl = process.argv[2] || "https://www.plex.tv/careers/open-jobs/?gh_jid=4780717101&gh_src=yjrb6262teu&jr_id=698fcfd10cc8ea15f1da6b31";
  
  console.log("🧪 Job Description Extraction Test");
  console.log("=" .repeat(60));
  console.log(`📄 Testing URL: ${testUrl}\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log("🌐 Navigating to page...");
    // Try to navigate, but be lenient with timeouts
    try {
      await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      console.log("✅ Page loaded\n");
    } catch (e: any) {
      if (e.message.includes("Timeout")) {
        console.log("⚠️  Navigation timeout, but continuing anyway...");
        // Wait a bit and continue
        await page.waitForTimeout(3000);
      } else {
        throw e;
      }
    }
    
    // Wait for content to render
    await page.waitForTimeout(3000);

    // Debug: Check page title and URL
    const pageTitle = await page.title();
    const currentUrl = page.url();
    console.log(`📋 Page Title: ${pageTitle}`);
    console.log(`🔗 Current URL: ${currentUrl}\n`);

    // Debug: Check for common elements
    console.log("🔍 Debugging page structure...");
    const h1Count = await page.locator("h1").count();
    const h2Count = await page.locator("h2").count();
    const mainCount = await page.locator("main").count();
    const articleCount = await page.locator("article").count();
    console.log(`  - H1 elements: ${h1Count}`);
    console.log(`  - H2 elements: ${h2Count}`);
    console.log(`  - Main elements: ${mainCount}`);
    console.log(`  - Article elements: ${articleCount}`);

    // Debug: Get page text preview
    try {
      const bodyText = await page.locator("body").innerText();
      console.log(`  - Body text length: ${bodyText.length} chars`);
      if (bodyText.length > 0) {
        console.log(`  - Body text preview (first 200 chars): ${bodyText.substring(0, 200)}...`);
      }
    } catch (e) {
      console.log(`  - Could not get body text: ${e}`);
    }

    // Debug: Check for job-related text
    try {
      const allText = await page.locator("body").innerText();
      const lowerText = allText.toLowerCase();
      const hasJobKeywords = [
        "engineer", "developer", "responsibilities", "requirements",
        "qualifications", "experience", "skills", "job overview"
      ].some(kw => lowerText.includes(kw));
      console.log(`  - Contains job keywords: ${hasJobKeywords}\n`);
    } catch (e) {
      console.log(`  - Could not check keywords\n`);
    }

    console.log("📝 Extracting job description...\n");
    const description = await extractJobDescription(page);

    console.log("\n" + "=".repeat(60));
    if (description && description.length > 0) {
      console.log("✅ SUCCESS: Job description extracted!");
      console.log(`📊 Length: ${description.length} characters\n`);
      console.log("📄 Description Preview (first 500 chars):");
      console.log("-".repeat(60));
      console.log(description.substring(0, 500) + (description.length > 500 ? "..." : ""));
      console.log("-".repeat(60));
      console.log(`\n📄 Full Description (${description.length} chars):`);
      console.log("=".repeat(60));
      console.log(description);
      console.log("=".repeat(60));
    } else {
      console.log("❌ FAILED: Could not extract job description");
      console.log("The extraction function returned an empty string.");
    }
  } catch (error: any) {
    console.error("\n❌ ERROR:", error.message);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
  } finally {
    console.log("\n⏳ Keeping browser open for 10 seconds for inspection...");
    await page.waitForTimeout(10000);
    await browser.close();
  }
}

main().catch(console.error);
