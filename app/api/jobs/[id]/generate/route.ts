import { NextRequest } from "next/server";

import { generateResumeAndCoverLetter } from "@/lib/generateDocuments";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const jobApplicationId = Number(params.id);

    if (isNaN(jobApplicationId)) {
      return new Response(
        JSON.stringify({ error: "Invalid job application ID" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    let body: any = {};
    try {
      const bodyText = await req.text();
      if (bodyText) {
        body = JSON.parse(bodyText);
      }
    } catch (e) {
      // Use defaults if body parsing fails
    }

    const options = {
      model: body.model || "gpt-4",
      outputDir: body.outputDir || "Resumes",
      saveToDatabase: body.saveToDatabase !== false,
      resumeTemplatePath: body.resumeTemplatePath,
      coverLetterTemplatePath: body.coverLetterTemplatePath,
      source: body.source, // "openai-api" | "chatgpt-ui" – overrides DOC_GENERATION_SOURCE when set
    };

    // No longer need baseResumeId - we use the template .docx file directly
    const result = await generateResumeAndCoverLetter(
      jobApplicationId,
      options
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: "Resume and cover letter generated successfully",
        ...result,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
