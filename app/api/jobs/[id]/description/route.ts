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
