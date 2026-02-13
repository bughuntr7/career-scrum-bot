import { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";

// GET - Get a specific resume
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);

    if (isNaN(id)) {
      return new Response(
        JSON.stringify({ error: "Invalid resume ID" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const resume = await prisma.resume.findUnique({
      where: { id },
    });

    if (!resume) {
      return new Response(
        JSON.stringify({ error: "Resume not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify(resume), {
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

// PATCH - Update a resume
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);

    if (isNaN(id)) {
      return new Response(
        JSON.stringify({ error: "Invalid resume ID" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json();
    const { name, rawText } = body;

    const updateData: { name?: string; rawText?: string } = {};
    if (name !== undefined) updateData.name = name;
    if (rawText !== undefined) updateData.rawText = rawText;

    const resume = await prisma.resume.update({
      where: { id },
      data: updateData,
    });

    return new Response(JSON.stringify(resume), {
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

// DELETE - Delete a resume
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);

    if (isNaN(id)) {
      return new Response(
        JSON.stringify({ error: "Invalid resume ID" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    await prisma.resume.delete({
      where: { id },
    });

    return new Response(
      JSON.stringify({ message: "Resume deleted successfully" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
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
