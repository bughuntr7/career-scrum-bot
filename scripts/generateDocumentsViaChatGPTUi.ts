/**
 * Generate tailored resume + cover letter via ChatGPT web UI, then save as styled .docx.
 * Same templates and output as the main app. No OpenAI API.
 *
 * Usage:
 *   By job ID (uses main workflow with source=chatgpt-ui):
 *     npx tsx scripts/generateDocumentsViaChatGPTUi.ts --job-id 42
 *
 *   By files (no DB):
 *     set COMPANY=Acme Inc & set JOB_TITLE=Senior Engineer & set JOB_DESCRIPTION_FILE=path\to\description.txt
 *     npx tsx scripts/generateDocumentsViaChatGPTUi.ts
 *
 * Env: CHATGPT_CONTEXT_DIR, BASE_RESUME_FILE, RESUMES_OUTPUT_DIR. Log in once: npm run chatgpt:login
 */

import * as fs from "fs";
import * as path from "path";
import { prisma } from "../lib/prisma";
import { generateResumeAndCoverLetter } from "../lib/generateDocuments";
import { generateResumeAndCoverLetterViaChatGPTUi, getChatGPTContextDir } from "../lib/chatgptUiClient";
import { parseResumeText } from "../lib/resumeParser";
import {
  saveResumeAsDocx,
  saveCoverLetterAsDocx,
  saveJobDescriptionAsTxt,
  extractTextFromResumeTemplate,
} from "../lib/documentGenerator";

const mammoth = require("mammoth");

async function loadBaseResume(): Promise<string> {
  const samplePath = path.join(process.cwd(), "Resumes", "Templates", "Jiayong Lin_Sample.docx");
  const envPath = process.env.BASE_RESUME_FILE;
  if (envPath && fs.existsSync(path.resolve(envPath))) {
    return fs.readFileSync(path.resolve(envPath), "utf-8");
  }
  if (fs.existsSync(samplePath)) {
    const buffer = fs.readFileSync(samplePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  const templatePath = path.join(process.cwd(), "Resumes", "Templates", "Jiayong Lin.docx");
  return extractTextFromResumeTemplate(templatePath);
}

async function main() {
  console.log("\n📄 docs:chatgpt-ui – generate resume + cover letter via ChatGPT UI, output .docx\n");

  const args = process.argv.slice(2);
  const jobIdIndex = args.indexOf("--job-id");

  if (jobIdIndex >= 0 && args[jobIdIndex + 1]) {
    const id = parseInt(args[jobIdIndex + 1], 10);
    if (isNaN(id)) {
      console.error("Invalid --job-id");
      process.exit(1);
    }
    console.log("Fetching job from DB...");
    const job = await prisma.jobApplication.findUnique({
      where: { id },
      include: { jobDescription: true },
    });
    if (!job) {
      console.error(`Job ${id} not found.`);
      process.exit(1);
    }
    if (!job.jobDescription) {
      console.error(`Job ${id} has no job description.`);
      process.exit(1);
    }
    console.log(`\n📌 Using job from DB: ID ${id} – ${job.company} – ${job.title}\n`);

    await generateResumeAndCoverLetter(id, {
      source: "chatgpt-ui",
      saveToDatabase: true,
      onChatGPTSignInRequired: () =>
        new Promise((resolve) => {
          console.log("\n📋 Sign-in required. Log in to ChatGPT in the browser, then press ENTER here.\n");
          process.stdin.once("data", () => resolve());
        }),
    });

    console.log("\n✅ Done. Check Resumes/<Company+Role>/ for .docx files.");
    return;
  }

  // File-based mode (no job ID)
  const company = process.env.COMPANY || "";
  const jobTitle = process.env.JOB_TITLE || "";
  const descPath = process.env.JOB_DESCRIPTION_FILE;
  if (!company || !jobTitle || !descPath || !fs.existsSync(path.resolve(descPath))) {
    console.error("Without --job-id, set COMPANY, JOB_TITLE, and JOB_DESCRIPTION_FILE (path to .txt).");
    process.exit(1);
  }
  const jobDescription = fs.readFileSync(path.resolve(descPath), "utf-8");
  console.log(`\n📌 Using files: ${company} – ${jobTitle}\n`);

  const outputDir = process.env.RESUMES_OUTPUT_DIR || "Resumes";
  const resumeTemplatePath = path.join(process.cwd(), "Resumes", "Templates", "Jiayong Lin.docx");
  const coverLetterTemplatePath = path.join(process.cwd(), "Resumes", "Templates", "Cover Letter.docx");

  if (!fs.existsSync(resumeTemplatePath)) {
    console.error("Resume template not found:", resumeTemplatePath);
    process.exit(1);
  }
  if (!fs.existsSync(coverLetterTemplatePath)) {
    console.error("Cover letter template not found:", coverLetterTemplatePath);
    process.exit(1);
  }

  console.log("📄 Loading base resume...");
  const baseResumeText = await loadBaseResume();
  const parsedBase = parseResumeText(baseResumeText);
  console.log(`   Parsed: ${parsedBase.workExperiences.length} work experiences.\n`);

  const { resumeText: tailoredResumeText, coverLetterText } = await generateResumeAndCoverLetterViaChatGPTUi(
    { baseResumeText, jobDescription, company, role: jobTitle },
    {
      contextDir: getChatGPTContextDir(),
      onSignInRequired: () =>
        new Promise((resolve) => {
          console.log("\n📋 Sign-in required. Log in to ChatGPT in the browser, then press ENTER here.\n");
          process.stdin.once("data", () => resolve());
        }),
    }
  );

  const tailoredParsed = parseResumeText(tailoredResumeText);
  tailoredParsed.education = parsedBase.education;

  console.log("\n📁 Saving styled .docx (your templates)...");
  const resumePath = await saveResumeAsDocx(
    {
      summary: tailoredParsed.summary,
      skills: tailoredParsed.skills,
      workExperiences: tailoredParsed.workExperiences,
      education: tailoredParsed.education,
    },
    company,
    jobTitle,
    outputDir,
    resumeTemplatePath
  );
  const coverLetterPath = await saveCoverLetterAsDocx(
    coverLetterText,
    company,
    jobTitle,
    outputDir,
    coverLetterTemplatePath
  );
  const jobDescPath = await saveJobDescriptionAsTxt(jobDescription, company, jobTitle, outputDir);

  console.log("\n✅ Done.");
  console.log("   Resume:      ", resumePath);
  console.log("   Cover letter:", coverLetterPath);
  console.log("   Job desc:    ", jobDescPath);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
