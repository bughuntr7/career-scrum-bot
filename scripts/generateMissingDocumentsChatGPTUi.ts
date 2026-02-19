/**
 * Backfill: generate resume + cover letter for jobs that have a description but no docs yet.
 * Uses ChatGPT web UI (not OpenAI API). Log in once with npm run chatgpt:login; if session
 * expired, the script will prompt you to log in in the browser and press Enter.
 *
 * Usage: npm run docs:backfill:chatgpt-ui
 */

import { prisma } from "../lib/prisma";
import { generateResumeAndCoverLetter } from "../lib/generateDocuments";

async function main() {
  console.log("🔍 Backfill (ChatGPT UI): Generate documents for jobs with description, no docs yet\n");

  const outputDir = process.env.RESUMES_OUTPUT_DIR || "Resumes";

  const jobsNeedingDocs = await prisma.jobApplication.findMany({
    where: {
      jobDescription: {
        isNot: null,
      },
      tailoredResumes: {
        none: {},
      },
      coverLetters: {
        none: {},
      },
    },
    include: {
      jobDescription: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (jobsNeedingDocs.length === 0) {
    console.log("✅ No jobs found that need document generation (all have resume & cover letter).");
    return;
  }

  console.log(`🧾 Found ${jobsNeedingDocs.length} job(s) with descriptions but without documents.`);
  console.log(`   Using: ChatGPT web UI (DOC_GENERATION_SOURCE=chatgpt-ui)\n`);

  const onSignInRequired = () =>
    new Promise<void>((resolve) => {
      console.log("\n📋 Sign-in required. Log in to ChatGPT in the browser, then press ENTER here.\n");
      process.stdin.once("data", () => resolve());
    });

  let successCount = 0;
  let failureCount = 0;

  for (const job of jobsNeedingDocs) {
    console.log("\n────────────────────────────────────────────");
    console.log(`🧠 Job ${job.id}: ${job.title} at ${job.company}`);

    try {
      const result = await generateResumeAndCoverLetter(job.id, {
        source: "chatgpt-ui",
        outputDir,
        saveToDatabase: true,
        onChatGPTSignInRequired: onSignInRequired,
      });

      console.log("  ✅ Documents generated:");
      console.log(`     Resume: ${result.resumePath}`);
      console.log(`     Cover Letter: ${result.coverLetterPath}`);
      successCount++;
    } catch (error: any) {
      console.error(`  ❌ Failed: ${error.message || error}`);
      failureCount++;
    }
  }

  console.log("\n📊 Backfill completed.");
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ❌ Failed:  ${failureCount}`);
}

main()
  .catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
