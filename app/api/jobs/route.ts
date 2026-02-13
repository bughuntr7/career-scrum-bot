import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userIdParam = searchParams.get("userId");

  const userId = userIdParam ? Number(userIdParam) : undefined;

  const jobs = await prisma.jobApplication.findMany({
    where: userId ? { userId } : undefined,
    orderBy: { createdAt: "desc" },
  });

  return new Response(JSON.stringify(jobs), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

