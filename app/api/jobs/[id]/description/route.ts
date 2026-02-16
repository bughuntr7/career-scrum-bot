import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const jobId = Number(params.id);

  if (isNaN(jobId)) {
    return new Response(JSON.stringify({ error: "Invalid job ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const description = await prisma.jobDescription.findUnique({
    where: { jobApplicationId: jobId },
  });

  if (!description) {
    return new Response(JSON.stringify({ error: "Description not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(description), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const jobId = Number(params.id);

  if (isNaN(jobId)) {
    return new Response(JSON.stringify({ error: "Invalid job ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const { fullText } = body;

    if (typeof fullText !== "string") {
      return new Response(JSON.stringify({ error: "fullText must be a string" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if description exists
    const existing = await prisma.jobDescription.findUnique({
      where: { jobApplicationId: jobId },
    });

    if (existing) {
      // Update existing description
      const updated = await prisma.jobDescription.update({
        where: { jobApplicationId: jobId },
        data: { fullText },
      });

      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } else {
      // Create new description
      const created = await prisma.jobDescription.create({
        data: {
          jobApplicationId: jobId,
          fullText,
          source: "manual",
        },
      });

      return new Response(JSON.stringify(created), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error: any) {
    console.error("Error updating job description:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to update job description" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
