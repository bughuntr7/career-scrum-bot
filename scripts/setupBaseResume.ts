import { prisma } from "../lib/prisma";
import * as fs from "fs";
import * as path from "path";

async function setupBaseResume() {
  console.log("🔍 Checking for base resume in database...\n");

  // Get the default user (or first user)
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error("❌ No user found in database. Please create a user first.");
    process.exit(1);
  }

  console.log(`✅ Found user: ${user.email} (ID: ${user.id})\n`);

  // Check if resume already exists
  const existingResume = await prisma.resume.findFirst({
    where: { userId: user.id },
  });

  if (existingResume) {
    console.log(`✅ Base resume already exists:`);
    console.log(`   ID: ${existingResume.id}`);
    console.log(`   Name: ${existingResume.name}`);
    console.log(`   Created: ${existingResume.createdAt}`);
    console.log(`   Text length: ${existingResume.rawText.length} characters\n`);
    
    console.log("📋 Resume preview (first 200 chars):");
    console.log(existingResume.rawText.substring(0, 200) + "...\n");
    
    return existingResume;
  }

  // Try to read from template file
  const templatePath = path.join(process.cwd(), "Resumes", "Templates", "Jiayong Lin.docx");
  let resumeText = "";

  if (fs.existsSync(templatePath)) {
    console.log(`📄 Found template file: ${templatePath}`);
    console.log("⚠️  Note: .docx files need to be converted to text manually.");
    console.log("   Please provide the resume text.\n");
  }

  // If no template or can't read it, prompt for input
  if (!resumeText) {
    console.log("📝 No template found. Please provide your base resume text.");
    console.log("   You can:");
    console.log("   1. Copy/paste your resume text here");
    console.log("   2. Or create a text file and provide the path\n");
    
    // For now, we'll create a placeholder
    // In a real scenario, you'd read from stdin or a file
    resumeText = `SUMMARY
[Your professional summary here]

SKILLS
[Your skills here]

PROFESSIONAL EXPERIENCE
[Your work experience here]

EDUCATION
[Your education here]`;

    console.log("⚠️  Using placeholder resume. Please update it manually.\n");
  }

  // Create the resume
  const resume = await prisma.resume.create({
    data: {
      userId: user.id,
      name: "Base Resume",
      rawText: resumeText,
    },
  });

  console.log(`✅ Created base resume:`);
  console.log(`   ID: ${resume.id}`);
  console.log(`   Name: ${resume.name}`);
  console.log(`   Text length: ${resume.rawText.length} characters\n`);

  return resume;
}

// Main execution
setupBaseResume()
  .then((resume) => {
    console.log("\n✅ Setup complete! Base resume ID:", resume.id);
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
