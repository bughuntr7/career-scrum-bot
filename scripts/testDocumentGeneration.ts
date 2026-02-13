import { prisma } from "../lib/prisma";
import { generateResumeAndCoverLetter } from "../lib/generateDocuments";
import * as fs from "fs";
import * as path from "path";

async function testDocumentGeneration() {
  console.log("🧪 Testing Document Generation System\n");
  console.log("=" .repeat(60));

  // Step 1: Check template files
  console.log("\n1️⃣  Checking template files...");
  const resumeTemplate = path.join(process.cwd(), "Resumes", "Templates", "Jiayong Lin.docx");
  const coverLetterTemplate = path.join(process.cwd(), "Resumes", "Templates", "Cover Letter.docx");

  if (!fs.existsSync(resumeTemplate)) {
    console.error(`❌ Resume template not found: ${resumeTemplate}`);
    console.error("   Please ensure your template is at: Resumes/Templates/Jiayong Lin.docx");
    process.exit(1);
  }
  console.log(`✅ Resume template found: ${resumeTemplate}`);

  if (!fs.existsSync(coverLetterTemplate)) {
    console.error(`❌ Cover letter template not found: ${coverLetterTemplate}`);
    console.error("   Please ensure your template is at: Resumes/Templates/Cover Letter.docx");
    process.exit(1);
  }
  console.log(`✅ Cover letter template found: ${coverLetterTemplate}`);

  // Step 2: Check for job applications with descriptions
  console.log("\n2️⃣  Checking for job applications with descriptions...");
  const jobsWithDescriptions = await prisma.jobApplication.findMany({
    where: {
      jobDescription: {
        isNot: null,
      },
    },
    include: {
      jobDescription: true,
    },
    take: 5,
    orderBy: {
      createdAt: "desc",
    },
  });

  if (jobsWithDescriptions.length === 0) {
    console.error("❌ No job applications with descriptions found in database.");
    console.error("   Please run the job scanner first: npm run jobright:scan");
    process.exit(1);
  }

  console.log(`✅ Found ${jobsWithDescriptions.length} job(s) with descriptions:`);
  jobsWithDescriptions.forEach((job, index) => {
    console.log(`   ${index + 1}. ID: ${job.id} - ${job.company} - ${job.title}`);
    console.log(`      Description length: ${job.jobDescription?.fullText.length || 0} chars`);
  });

  // Step 3: Check OpenAI API key
  console.log("\n3️⃣  Checking OpenAI API key...");
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY not set in environment variables");
    console.error("   Please set it in your .env file");
    process.exit(1);
  }
  console.log("✅ OPENAI_API_KEY is set");

  // Step 4: Test with first job
  const testJob = jobsWithDescriptions[0];
  console.log(`\n4️⃣  Testing document generation for:`);
  console.log(`   Job ID: ${testJob.id}`);
  console.log(`   Company: ${testJob.company}`);
  console.log(`   Role: ${testJob.title}`);
  console.log(`   Description: ${testJob.jobDescription?.fullText.substring(0, 100)}...`);

  console.log("\n⏳ Generating documents (this may take 30-60 seconds)...\n");

  try {
    const result = await generateResumeAndCoverLetter(testJob.id, {
      model: "gpt-4-turbo-preview",
      outputDir: "Resumes",
      saveToDatabase: true,
    });

    console.log("\n✅ Document generation successful!\n");
    console.log("📁 Generated files:");
    console.log(`   Resume: ${result.resumePath}`);
    console.log(`   Cover Letter: ${result.coverLetterPath}`);
    console.log(`   Job Description: ${result.jobDescriptionPath}`);

    // Verify files exist
    console.log("\n5️⃣  Verifying generated files...");
    if (fs.existsSync(result.resumePath)) {
      const stats = fs.statSync(result.resumePath);
      console.log(`✅ Resume file exists (${(stats.size / 1024).toFixed(2)} KB)`);
    } else {
      console.error(`❌ Resume file not found: ${result.resumePath}`);
    }

    if (fs.existsSync(result.coverLetterPath)) {
      const stats = fs.statSync(result.coverLetterPath);
      console.log(`✅ Cover letter file exists (${(stats.size / 1024).toFixed(2)} KB)`);
    } else {
      console.error(`❌ Cover letter file not found: ${result.coverLetterPath}`);
    }

    if (fs.existsSync(result.jobDescriptionPath)) {
      const stats = fs.statSync(result.jobDescriptionPath);
      console.log(`✅ Job description file exists (${(stats.size / 1024).toFixed(2)} KB)`);
    } else {
      console.error(`❌ Job description file not found: ${result.jobDescriptionPath}`);
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ Test completed successfully!");
    console.log("\n💡 Next steps:");
    console.log("   1. Open the generated .docx files to verify formatting");
    console.log("   2. Check that the content is tailored to the job description");
    console.log("   3. If formatting needs adjustment, update your templates");
    console.log("\n");

  } catch (error: any) {
    console.error("\n❌ Error during document generation:");
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error("\nStack trace:");
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Main execution
testDocumentGeneration()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
