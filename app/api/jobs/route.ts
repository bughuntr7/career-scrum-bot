import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userIdParam = searchParams.get("userId");

  const userId = userIdParam ? Number(userIdParam) : undefined;

  const sourceFilter = searchParams.get("source"); // optional: jobright, ziprecruiter

  const jobs = await prisma.jobApplication.findMany({
    where: {
      ...(userId ? { userId } : {}),
      ...(sourceFilter ? { source: sourceFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      company: true,
      source: true,
      externalUrl: true,
      createdAt: true,
      jobrightMatchScore: true,
      jobDescription: {
        select: {
          id: true,
        },
      },
      tailoredResumes: {
        select: {
          id: true,
        },
      },
      coverLetters: {
        select: {
          id: true,
        },
      },
    },
  });

  // Add flags to match page.tsx structure
  const jobsWithFlags = jobs.map((job) => ({
    ...job,
    hasDescription: !!job.jobDescription,
    hasResume: job.tailoredResumes.length > 0,
    hasCoverLetter: job.coverLetters.length > 0,
  }));

  return new Response(JSON.stringify(jobsWithFlags), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

