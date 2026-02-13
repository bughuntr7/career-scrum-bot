import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

// GET - List all resumes
export async function GET(req: NextRequest) {
  try {
    const resumes = await prisma.resume.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        rawText: false, // Don't include full text in list
      },
    });

    return new Response(JSON.stringify(resumes), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

// POST - Create a new resume
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, rawText, userId } = body;

    if (!name || !rawText) {
      return new Response(
        JSON.stringify({ error: "name and rawText are required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get user (use provided userId or find first user)
    let actualUserId = userId;
    if (!actualUserId) {
      const user = await prisma.user.findFirst();
      if (!user) {
        return new Response(
          JSON.stringify({ error: "No user found. Please create a user first." }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      actualUserId = user.id;
    }

    const resume = await prisma.resume.create({
      data: {
        userId: actualUserId,
        name,
        rawText,
      },
    });

    return new Response(JSON.stringify(resume), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
