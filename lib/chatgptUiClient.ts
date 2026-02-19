/**
 * Generate tailored resume and cover letter via ChatGPT web UI (Playwright).
 * Used when DOC_GENERATION_SOURCE=chatgpt-ui or when explicitly requested.
 * No OpenAI API; uses paid ChatGPT session (log in once with npm run chatgpt:login).
 */

import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

const CHATGPT_URL = "https://chat.openai.com";

export function getChatGPTContextDir(): string {
  const base = process.env.USERPROFILE || process.env.HOME || ".";
  const dir = process.env.CHATGPT_CONTEXT_DIR;
  if (!dir) return path.join(base, ".jobbot", "chatgpt");
  const clean = dir.split(/\s+/)[0].trim().replace(/^["']|["']$/g, "");
  return path.resolve(clean.replace(/^~/, base));
}

function buildResumePrompt(baseResume: string, jobDescription: string): string {
  return `Your role is to act as a talented, human-centered resume writer who helps tailor my resume to each job description while making it sound authentic, specific, and grounded in real-world experience.

BASE RESUME:
${baseResume}

JOB DESCRIPTION:
${jobDescription}

INSTRUCTIONS:
Do not change the section headings. They must remain exactly:
- SUMMARY
- SKILLS
- PROFESSIONAL EXPERIENCE
- EDUCATION

Do not change my name, company names, employment dates, or high-level role titles.

IMPORTANT: Do NOT modify the EDUCATION section. Keep it exactly as it appears in the base resume.

PROFESSIONAL EXPERIENCE – structure for each role:
- First line: Title | Company | Location | Date (unchanged).
- Next line: Exactly one line in parentheses that briefly describes the company or the scope of the role (e.g. "(Meta builds foundational AI systems and large-scale ML infrastructure serving billions of users.)"). Use factual, one-sentence context so readers get quick orientation.
- Then bullet points, then "Technologies & Skills: ..." as below.

You can modify the technologies, tools, and skills mentioned in the Summary, Professional Experience, Skills, and Work History bullet points to align naturally with the target job.

CRITICAL - Technologies & Skills Sections:
- Each work experience section ends with a "Technologies & Skills:" line listing the tech stack used at that company
- You MUST tailor these "Technologies & Skills:" sections to align with the job description
- This is one of the MOST IMPORTANT parts of tailoring - these sections directly show relevant tech experience
- For each work experience:
  * Include ALL technologies from the job description that are relevant to that role/company
  * Remove technologies that are NOT mentioned in the job description (unless they're core to that company's work)
  * Add new technologies from the job description that make sense for that work experience context
  * Prioritize technologies that appear in both the job description AND are relevant to that company's work
- Keep the exact format: "Technologies & Skills:" followed by a list separated by " · " (middle dot)
- These tech skills sections are company-specific and should reflect what was realistically used at that company
- Make sure technologies from the job description appear in the most relevant work experience(s)

Focus on:
- Including all important keywords, tools, and technologies from the job description
- Naturally integrating them into the bullet points and project descriptions, especially within my most recent roles
- Emphasizing the target tech stack across the resume, even if it means adjusting tools or languages already written
- Reflecting those tools in real, concrete use cases or project examples, not just buzzwords
- Writing in a clear, natural tone that feels like a person describing meaningful work, not a keyword-stuffed list

The final result should be a complete, tailored resume in plain text—clear, specific, and human—without generic language or explanations.

CRITICAL: Return ONLY the complete tailored resume text. Do NOT include any preamble, explanation, or conversational text. Start directly with the resume header (name, title, contact information).`;
}

function buildCoverLetterPrompt(
  baseResume: string,
  jobDescription: string,
  companyName: string,
  jobTitle: string
): string {
  return `Your role is to act as a talented, creative cover letter writer who writes compelling, story-like cover letters that connect candidates to job opportunities.

CANDIDATE'S RESUME:
${baseResume.substring(0, 2000)}... (summary of candidate's background)

JOB DESCRIPTION:
${jobDescription}

COMPANY: ${companyName}
POSITION: ${jobTitle}

INSTRUCTIONS:
1. **Style**: Write in a story-like, creative, verbal style - make it engaging, personal, and memorable
2. **No Bullets**: Do NOT use bullet points, bullet symbols (-), or lists
3. **Length**: Write at least 12 sentences (aim for 3-4 paragraphs)
4. **Personalization**: 
   - Directly address the company and specific role
   - Weave in specific experiences from the candidate's background that relate to the job description
   - Show how the candidate's skills and experiences align with what the company needs
5. **Enthusiasm**: Convey genuine enthusiasm for the role and the company
6. **Structure**: 
   - Opening: Hook that connects candidate's journey to this opportunity
   - Body (2-3 paragraphs): Specific examples of relevant experience, skills, and achievements
   - Closing: Strong conclusion expressing eagerness for an interview
7. **Tone**: Professional but warm, confident but humble, authentic and human
8. **Specificity**: Reference specific technologies, projects, or achievements from the resume that match the job requirements

CRITICAL: Return ONLY the cover letter body text. Do NOT include:
- Salutations (e.g., "Dear Hiring Manager,")
- Closings (e.g., "Sincerely," or "Best regards,")
- Your name or signature
- Any preamble or explanation

Start directly with the first paragraph of the cover letter.`;
}

function isLoginPage(page: any): Promise<boolean> {
  return page.evaluate(() => {
    const url = window.location.href;
    return /auth\/login|auth\/callback|\/login/i.test(url) || url.includes("/auth/");
  });
}

async function waitForComposerOrLoginPrompt(page: any, timeoutMs: number = 15000): Promise<"composer" | "login"> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isLoginPage(page)) return "login";
    const textbox = page.getByRole("textbox", { name: /message|send a message|chat/i }).first();
    const editable = page.locator('[contenteditable="true"]').first();
    const textarea = page.locator('textarea[placeholder*="Message"], textarea[placeholder*="message"]').first();
    for (const loc of [textbox, editable, textarea]) {
      try {
        await loc.waitFor({ state: "visible", timeout: 2000 });
        return "composer";
      } catch {
        /* try next */
      }
    }
    await page.waitForTimeout(1500);
  }
  return "login";
}

async function waitForComposer(
  page: any,
  timeoutMs: number = 60000,
  onSignInRequired?: () => Promise<void>
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await waitForComposerOrLoginPrompt(page, 10000);
    if (result === "composer") return;
    if (onSignInRequired) {
      await onSignInRequired();
      await page.waitForTimeout(3000);
      continue;
    }
    throw new Error("ChatGPT sign-in required. Run npm run chatgpt:login first, then try again.");
  }
  throw new Error("ChatGPT composer not found. Run npm run chatgpt:login first.");
}

async function sendMessageAndGetReply(page: any, prompt: string): Promise<string> {
  const selectors = [
    'textarea[placeholder*="Message"], textarea[placeholder*="message"]',
    '[contenteditable="true"]',
    'div[role="textbox"]',
  ];
  let filled = false;
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      await el.waitFor({ state: "visible", timeout: 5000 });
      await el.click();
      await el.fill("");
      await el.fill(prompt);
      filled = true;
      break;
    } catch {
      /* continue */
    }
  }
  if (!filled) await page.keyboard.type(prompt, { delay: 10 });

  const sendButton = page.locator('button[type="submit"]').or(page.getByRole("button", { name: /send|submit/i }).last());
  await sendButton.first().click();

  await page.waitForTimeout(3000);
  const lastAssistant = page.locator('[data-message-author-role="assistant"]').last();
  await lastAssistant.waitFor({ state: "visible", timeout: 120000 });

  const contentEl = lastAssistant.locator('div[class*="markdown"]').first();
  let prevLen = 0;
  let stableCount = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    const current = await contentEl.textContent();
    const len = (current || "").length;
    if (len === prevLen && len > 0) {
      stableCount++;
      if (stableCount >= 3) break;
    } else stableCount = 0;
    prevLen = len;
  }
  await page.waitForTimeout(1000);

  const parts = await lastAssistant.locator('div[class*="markdown"]').allTextContents();
  return (parts.join("\n\n").trim() || (await contentEl.textContent()) || "").trim();
}

export type GenerateViaChatGPTUiOptions = {
  contextDir?: string;
  headless?: boolean;
  /** When sign-in is required (e.g. in CLI script), wait for user to log in and resolve */
  onSignInRequired?: () => Promise<void>;
};

/**
 * Generate tailored resume and cover letter text via ChatGPT web UI.
 * Launches browser, sends prompts, captures replies. Uses persistent context so login is reused.
 */
export async function generateResumeAndCoverLetterViaChatGPTUi(
  params: {
    baseResumeText: string;
    jobDescription: string;
    company: string;
    role: string;
  },
  options: GenerateViaChatGPTUiOptions = {}
): Promise<{ resumeText: string; coverLetterText: string }> {
  const { contextDir = getChatGPTContextDir(), headless = false, onSignInRequired } = options;

  if (!fs.existsSync(contextDir)) {
    fs.mkdirSync(contextDir, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(contextDir, {
    headless,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
  });

  try {
    const page = await context.newPage();
    await page.goto(CHATGPT_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);

    await waitForComposer(page, 60000, onSignInRequired);

    const resumeText = await sendMessageAndGetReply(
      page,
      buildResumePrompt(params.baseResumeText, params.jobDescription)
    );
    await page.waitForTimeout(2000);

    const coverLetterText = await sendMessageAndGetReply(
      page,
      buildCoverLetterPrompt(
        params.baseResumeText,
        params.jobDescription,
        params.company,
        params.role
      )
    );

    return { resumeText, coverLetterText };
  } finally {
    await context.close();
  }
}
