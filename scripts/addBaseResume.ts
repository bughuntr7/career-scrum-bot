import { prisma } from "../lib/prisma";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

async function addBaseResume() {
  console.log("🔍 Setting up base resume...\n");

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
    
    console.log("📋 Resume preview (first 300 chars):");
    console.log("─".repeat(60));
    console.log(existingResume.rawText.substring(0, 300) + "...");
    console.log("─".repeat(60));
    console.log("\n💡 To update it, use the API endpoint or Prisma Studio\n");
    
    return existingResume;
  }

  // Try to read from a text file
  const textFilePath = path.join(process.cwd(), "Resumes", "base-resume.txt");
  let resumeText = "";

  if (fs.existsSync(textFilePath)) {
    console.log(`📄 Found text file: ${textFilePath}`);
    resumeText = fs.readFileSync(textFilePath, "utf-8");
    console.log(`✅ Loaded resume from file (${resumeText.length} characters)\n`);
  } else {
    console.log("📝 No base-resume.txt file found.");
    console.log("   Creating a template file for you...\n");
    
    // Create template file
    const templateText = `SUMMARY
[Your professional summary here - 2-3 sentences about your experience and expertise]

SKILLS
[Your technical skills, tools, and technologies - one per line or comma-separated]

PROFESSIONAL EXPERIENCE

[Company Name] - [Job Title]
[Start Date] - [End Date or Present]
- [Achievement or responsibility]
- [Achievement or responsibility]
- [Achievement or responsibility]

[Company Name] - [Job Title]
[Start Date] - [End Date or Present]
- [Achievement or responsibility]
- [Achievement or responsibility]

EDUCATION

[Degree] in [Field]
[University Name]
[Graduation Year]
`;

    fs.writeFileSync(textFilePath, templateText, "utf-8");
    console.log(`✅ Created template file: ${textFilePath}`);
    console.log("   Please edit this file with your resume content, then run this script again.\n");
    process.exit(0);
  }

  if (!resumeText || resumeText.trim().length < 50) {
    console.error("❌ Resume text is too short or empty. Please add content to base-resume.txt");
    process.exit(1);
  }

  // Create the resume
  const resume = await prisma.resume.create({
    data: {
      userId: user.id,
      name: "Base Resume",
      rawText: resumeText.trim(),
    },
  });

  console.log(`✅ Created base resume:`);
  console.log(`   ID: ${resume.id}`);
  console.log(`   Name: ${resume.name}`);
  console.log(`   Text length: ${resume.rawText.length} characters\n`);

  return resume;
}

// Main execution
addBaseResume()
  .then((resume) => {
    console.log("\n✅ Setup complete! Base resume ID:", resume.id);
    console.log("   You can now use this resume ID when generating tailored resumes.\n");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
