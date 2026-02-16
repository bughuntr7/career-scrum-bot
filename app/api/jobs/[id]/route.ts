import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

// GET single job
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const job = await prisma.jobApplication.findUnique({
      where: { id: parseInt(params.id) },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch job" }, { status: 500 });
  }
}

// UPDATE job
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { title, company, externalUrl } = body;

    const job = await prisma.jobApplication.update({
      where: { id: parseInt(params.id) },
      data: {
        ...(title && { title }),
        ...(company && { company }),
        ...(externalUrl && { externalUrl }),
      },
    });

    return NextResponse.json(job);
  } catch (error) {
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
  }
}

// DELETE job
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const jobId = parseInt(params.id);

    // First, fetch the job to get company and title for file cleanup
    const job = await prisma.jobApplication.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        company: true,
        title: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Delete all related records first (due to ON DELETE RESTRICT constraints)
    // 1. Delete CoverLetters
    await prisma.coverLetter.deleteMany({
      where: { jobApplicationId: jobId },
    });

    // 2. Delete TailoredResumes
    await prisma.tailoredResume.deleteMany({
      where: { jobApplicationId: jobId },
    });

    // 3. Delete JobDescription
    await prisma.jobDescription.deleteMany({
      where: { jobApplicationId: jobId },
    });

    // 4. Finally, delete the JobApplication
    await prisma.jobApplication.delete({
      where: { id: jobId },
    });

    // 5. Optionally delete generated files from filesystem
    try {
      const fs = require("fs");
      const path = require("path");
      
      // Generate folder name using the same logic as documentGenerator
      // Clean company name and role (remove invalid filename characters)
      const cleanCompany = job.company.replace(/[<>:"/\\|?*]/g, "").trim();
      const cleanRole = job.title.replace(/[<>:"/\\|?*]/g, "").trim();
      const folderName = `${cleanCompany}+${cleanRole}`;
      const folderPath = path.join(process.cwd(), "Resumes", folderName);
      
      if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
        console.log(`✅ Deleted folder: ${folderPath}`);
      }
    } catch (fileError) {
      // Don't fail the delete if file cleanup fails
      console.warn(`⚠️  Failed to delete files for job ${jobId}:`, fileError);
    }

    return NextResponse.json({ 
      success: true,
      message: "Job and all related data deleted successfully"
    });
  } catch (error: any) {
    console.error("Delete error:", error);
    return NextResponse.json({ 
      error: error.message || "Failed to delete job" 
    }, { status: 500 });
  }
}
