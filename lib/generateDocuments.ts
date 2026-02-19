import { prisma } from "./prisma";
import { generateTailoredResume, generateCoverLetter, PROMPT_VERSION } from "./llmService";
import { generateResumeAndCoverLetterViaChatGPTUi } from "./chatgptUiClient";
import {
  saveResumeAsDocx,
  saveCoverLetterAsDocx,
  saveJobDescriptionAsTxt,
  extractTextFromResumeTemplate,
} from "./documentGenerator";
import { parseResumeText, ParsedResume } from "./resumeParser";
import * as path from "path";
import * as fs from "fs";

// Use dynamic import for mammoth
const mammoth = require("mammoth");

/** Use ChatGPT web UI instead of OpenAI API when set to "chatgpt-ui" (env or options.source) */
const DEFAULT_DOC_SOURCE = (process.env.DOC_GENERATION_SOURCE || "openai-api") as string;

export async function generateResumeAndCoverLetter(
  jobApplicationId: number,
  options: {
    model?: string;
    outputDir?: string;
    saveToDatabase?: boolean;
    resumeTemplatePath?: string;
    coverLetterTemplatePath?: string;
    /** "openai-api" (default) or "chatgpt-ui". Overrides DOC_GENERATION_SOURCE when set. */
    source?: "openai-api" | "chatgpt-ui";
    /** Only for source=chatgpt-ui: called when sign-in is required (e.g. wait for user to press Enter in CLI) */
    onChatGPTSignInRequired?: () => Promise<void>;
  } = {}
): Promise<{
  resumePath: string;
  coverLetterPath: string;
  jobDescriptionPath: string;
  tailoredResumeId?: number;
  coverLetterId?: number;
}> {
  const {
    model = "gpt-4",
    outputDir = "Resumes",
    saveToDatabase = true,
    resumeTemplatePath,
    coverLetterTemplatePath,
    source = DEFAULT_DOC_SOURCE as "openai-api" | "chatgpt-ui",
    onChatGPTSignInRequired,
  } = options;

  const useChatGPTUi = source === "chatgpt-ui";
  const effectiveModel = useChatGPTUi ? "chatgpt-ui" : model;

  // Fetch job application and related data
  const jobApplication = await prisma.jobApplication.findUnique({
    where: { id: jobApplicationId },
    include: {
      jobDescription: true,
    },
  });

  if (!jobApplication) {
    throw new Error(`Job application ${jobApplicationId} not found`);
  }

  if (!jobApplication.jobDescription) {
    throw new Error(`Job description not found for job application ${jobApplicationId}`);
  }

  const jobDescription = jobApplication.jobDescription.fullText;
  const company = jobApplication.company;
  const role = jobApplication.title;

  // Extract text from sample file (full resume content)
  const resumeSamplePath = path.join(process.cwd(), "Resumes", "Templates", "Jiayong Lin_Sample.docx");
  const resumeTemplate = resumeTemplatePath || path.join(process.cwd(), "Resumes", "Templates", "Jiayong Lin.docx");
  const coverLetterTemplate = coverLetterTemplatePath || path.join(process.cwd(), "Resumes", "Templates", "Cover Letter.docx");

  console.log(`📄 Extracting full resume from sample file: ${resumeSamplePath}`);
  let baseResumeText: string;
  
  if (fs.existsSync(resumeSamplePath)) {
    const buffer = fs.readFileSync(resumeSamplePath);
    const result = await mammoth.extractRawText({ buffer });
    baseResumeText = result.value;
    console.log(`✅ Extracted ${baseResumeText.length} characters from sample file`);
  } else {
    // Fallback to template or text file
    baseResumeText = await extractTextFromResumeTemplate(resumeTemplate);
    console.log(`⚠️  Sample file not found, using template (${baseResumeText.length} chars)`);
  }

  // Parse resume into sections
  const parsedResume = parseResumeText(baseResumeText);
  console.log(`📋 Parsed resume: ${parsedResume.workExperiences.length} work experiences, Education preserved`);

  let tailoredResumeText: string;
  let coverLetterText: string;

  if (useChatGPTUi) {
    console.log(`🤖 Generating resume + cover letter via ChatGPT UI for ${company} - ${role}...`);
    const result = await generateResumeAndCoverLetterViaChatGPTUi(
      { baseResumeText, jobDescription, company, role },
      { onSignInRequired: onChatGPTSignInRequired }
    );
    tailoredResumeText = result.resumeText;
    coverLetterText = result.coverLetterText;
  } else {
    console.log(`🤖 Generating tailored resume for ${company} - ${role}...`);
    tailoredResumeText = await generateTailoredResume(baseResumeText, jobDescription, model);
    console.log(`🤖 Generating cover letter for ${company} - ${role}...`);
    coverLetterText = await generateCoverLetter(baseResumeText, jobDescription, company, role, model);
  }

  // Parse the tailored resume to extract sections (excluding Education)
  const tailoredParsed = parseResumeText(tailoredResumeText);
  tailoredParsed.education = parsedResume.education;

  // Save documents to filesystem (using templates to preserve styling)
  // Pass parsed resume sections to replace placeholders in template
  const resumePath = await saveResumeAsDocx(
    {
      summary: tailoredParsed.summary,
      skills: tailoredParsed.skills,
      workExperiences: tailoredParsed.workExperiences,
      education: tailoredParsed.education, // Preserved from original
    },
    company,
    role,
    outputDir,
    resumeTemplate
  );
  console.log(`✅ Saved styled resume to: ${resumePath}`);

  const coverLetterPath = await saveCoverLetterAsDocx(
    coverLetterText,
    company,
    role,
    outputDir,
    coverLetterTemplate
  );
  console.log(`✅ Saved styled cover letter to: ${coverLetterPath}`);

  const jobDescriptionPath = await saveJobDescriptionAsTxt(
    jobDescription,
    company,
    role,
    outputDir
  );
  console.log(`✅ Saved job description to: ${jobDescriptionPath}`);

  // Save to database if requested
  let tailoredResumeId: number | undefined;
  let coverLetterId: number | undefined;

  if (saveToDatabase) {
    // Get or create a base resume record for database tracking
    // (We use the template file, but still need a resume record for foreign keys)
    const user = await prisma.user.findFirst();
    if (!user) {
      throw new Error("No user found in database");
    }

    let baseResume = await prisma.resume.findFirst({
      where: { userId: user.id },
    });

    if (!baseResume) {
      // Create a placeholder resume record (we use template file, not this)
      baseResume = await prisma.resume.create({
        data: {
          userId: user.id,
          name: "Template Resume",
          rawText: baseResumeText, // Store extracted text for reference
        },
      });
    }

    // Save tailored resume to database
    const tailoredResume = await prisma.tailoredResume.create({
      data: {
        jobApplicationId,
        baseResumeId: baseResume.id,
        llmModel: effectiveModel,
        promptVersion: PROMPT_VERSION,
        outputText: tailoredResumeText,
      },
    });
    tailoredResumeId = tailoredResume.id;

    // Save cover letter to database
    const coverLetter = await prisma.coverLetter.create({
      data: {
        jobApplicationId,
        baseResumeId: baseResume.id,
        llmModel: effectiveModel,
        promptVersion: PROMPT_VERSION,
        outputText: coverLetterText,
      },
    });
    coverLetterId = coverLetter.id;

    // Update job application status
    await prisma.jobApplication.update({
      where: { id: jobApplicationId },
      data: {
        status: "READY_TO_APPLY",
      },
    });
  }

  return {
    resumePath,
    coverLetterPath,
    jobDescriptionPath,
    tailoredResumeId,
    coverLetterId,
  };
}
