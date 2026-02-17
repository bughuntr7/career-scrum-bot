import { prisma } from "../lib/prisma";
import { generateResumeAndCoverLetter } from "../lib/generateDocuments";

async function main() {
  console.log("🔍 Backfill: Generate documents for existing jobs");

  const model = process.env.OPENAI_MODEL || "gpt-4";
  const outputDir = process.env.RESUMES_OUTPUT_DIR || "Resumes";

  console.log(`📋 Using model: ${model}`);
  console.log(`📂 Output directory: ${outputDir}`);

  // Find jobs that have a job description but no tailored resume AND no cover letter
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
    orderBy: {
      createdAt: "asc",
    },
  });

  if (jobsNeedingDocs.length === 0) {
    console.log("✅ No jobs found that need document generation (all have resume & cover letter).");
    return;
  }

  console.log(`🧾 Found ${jobsNeedingDocs.length} job(s) with descriptions but without documents.`);

  let successCount = 0;
  let failureCount = 0;

  for (const job of jobsNeedingDocs) {
    console.log("\n────────────────────────────────────────────");
    console.log(`🧠 Job ${job.id}: ${job.title} at ${job.company}`);

    try {
      const result = await generateResumeAndCoverLetter(job.id, {
        model,
        outputDir,
        saveToDatabase: true,
      });

      console.log("  ✅ Documents generated successfully:");
      console.log(`     Resume: ${result.resumePath}`);
      console.log(`     Cover Letter: ${result.coverLetterPath}`);
      console.log(`     Job Description: ${result.jobDescriptionPath}`);
      successCount++;
    } catch (error: any) {
      console.error(`  ❌ Failed to generate documents for job ${job.id}: ${error.message || error}`);
      failureCount++;
    }
  }

  console.log("\n📊 Backfill completed.");
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ❌ Failed:  ${failureCount}`);
}

main()
  .catch((err) => {
    console.error("Unexpected error in generateMissingDocuments script:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

