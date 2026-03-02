import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const PROMPT_VERSION = "1.0";

/**
 * Generate a tailored resume based on job description.
 * Uses the user's exact prompt requirements, but pushes harder on explicit keyword / requirements coverage.
 */
export async function generateTailoredResume(
  baseResume: string,
  jobDescription: string,
  model: string = "gpt-4"
): Promise<string> {
  const prompt = `Your role is to act as a talented, human-centered resume writer who helps tailor my resume to each job description while making it sound authentic, specific, and grounded in real-world experience.

BASE RESUME:
${baseResume}

JOB DESCRIPTION:
${jobDescription}

INSTRUCTIONS:
Do not change the section headings. They must remain exactly:
- SUMMARY
- SKILLS
- PROFESSIONAL EXPERIENCE
- EDUCATION

Do not change my name, company names, employment dates, or high-level role titles.

IMPORTANT: Do NOT modify the EDUCATION section. Keep it exactly as it appears in the base resume.

PROFESSIONAL EXPERIENCE – structure for each role:
- First line: Title | Company | Location | Date (unchanged).
- Next line: Exactly one line in parentheses that briefly describes the company or the scope of the role (e.g. "(Meta builds foundational AI systems and large-scale ML infrastructure serving billions of users.)"). Use factual, one-sentence context so readers get quick orientation.
- Then bullet points, then "Technologies & Skills: ..." as below.

You can modify the technologies, tools, and skills mentioned in the Summary, Professional Experience, Skills, and Work History bullet points to align naturally with the target job.

CRITICAL - Technologies & Skills Sections:
- Each work experience section ends with a "Technologies & Skills:" line listing the tech stack used at that company
- You MUST tailor these "Technologies & Skills:" sections to align with the job description
- This is one of the MOST IMPORTANT parts of tailoring - these sections directly show relevant tech experience
- For each work experience:
  * Include ALL technologies from the job description that are relevant to that role/company
  * Remove technologies that are NOT mentioned in the job description (unless they're core to that company's work)
  * Add new technologies from the job description that make sense for that work experience context
  * Prioritize technologies that appear in both the job description AND are relevant to that company's work
- Keep the exact format: "Technologies & Skills:" followed by a list separated by " · " (middle dot)
- These tech skills sections are company-specific and should reflect what was realistically used at that company
- Make sure technologies from the job description appear in the most relevant work experience(s)

Focus on:
- Including all important keywords, tools, and technologies from the job description
- Naturally integrating them into the bullet points and project descriptions, especially within my most recent roles
- Emphasizing the target tech stack across the resume, even if it means adjusting tools or languages already written
- Reflecting those tools in real, concrete use cases or project examples, not just buzzwords
- Writing in a clear, natural tone that feels like a person describing meaningful work, not a keyword-stuffed list

KEYWORD / REQUIREMENTS COVERAGE (VERY IMPORTANT):
- Carefully read the JOB DESCRIPTION and identify the most important:
  * Skills / technologies / frameworks / platforms
  * Responsibilities and outcomes (what success looks like in this role)
  * Domain context (e.g. B2B SaaS, ML infra, data platforms, LLM agents, etc.)
- For each MAJOR skill/technology mentioned in the job description:
  * Try to reflect it in at least ONE of:
    - SUMMARY
    - SKILLS
    - A bullet + the "Technologies & Skills" line of a RECENT work experience (ideally last 2–3 roles)
  * If it is not realistically aligned with the candidate's background, skip it rather than inventing experience.
- Prioritize coverage in the most recent roles first – match the job's tech stack and responsibilities as closely as possible there.
- Make sure the final resume would score highly in an automated keyword scan against the job description, while still reading as an honest, coherent narrative.

Additionally:
- Research each company I've worked for and suggest realistic features, problems solved, improvements, or initiatives I might have worked on based on their business at the time
- Add bullet points that reflect those projects using the target tech stack
- Keep any original bullet points that still fit naturally with the new focus

Important: Any technology or skill listed in the Summary or Skills section should also appear in the Professional Experience section in real-world context, AND in the "Technologies & Skills:" section of the relevant work experience.

The final result should be a complete, tailored resume in plain text—clear, specific, and human—without generic language or explanations.

CRITICAL: Return ONLY the complete tailored resume text. Do NOT include any preamble, explanation, or conversational text. Start directly with the resume header (name, title, contact information).`;

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are an expert resume writer who tailors resumes to job descriptions while maintaining authenticity and accuracy.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content || "";
  } catch (error: any) {
    throw new Error(`Failed to generate tailored resume: ${error.message}`);
  }
}

/**
 * Generate a story-like cover letter.
 *
 * Requirements:
 * - Story-like, creative, verbal style
 * - No bullet symbols (-)
 * - At least 12 sentences
 * - Connects candidate's experience to job opportunity
 * - Explicitly covers the key requirements / technologies from the job description
 */
export async function generateCoverLetter(
  baseResume: string,
  jobDescription: string,
  companyName: string,
  jobTitle: string,
  model: string = "gpt-4"
): Promise<string> {
  const prompt = `Your role is to act as a talented, creative cover letter writer who writes compelling, story-like cover letters that connect candidates to job opportunities.

CANDIDATE'S RESUME:
${baseResume.substring(0, 2000)}... (summary of candidate's background)

JOB DESCRIPTION:
${jobDescription}

COMPANY: ${companyName}
POSITION: ${jobTitle}

INSTRUCTIONS:
1. **Style**: Write in a story-like, creative, verbal style - make it engaging, personal, and memorable
2. **No Bullets**: Do NOT use bullet points, bullet symbols (-), or lists
3. **Length**: Write at least 12 sentences (aim for 3-4 paragraphs)
4. **Personalization**: 
   - Directly address the company and specific role
   - Weave in specific experiences from the candidate's background that relate to the job description
   - Show how the candidate's skills and experiences align with what the company needs
5. **Enthusiasm**: Convey genuine enthusiasm for the role and the company
6. **Structure**: 
   - Opening: Hook that connects candidate's journey to this opportunity
   - Body (2-3 paragraphs): Specific examples of relevant experience, skills, and achievements
   - Closing: Strong conclusion expressing eagerness for an interview
7. **Tone**: Professional but warm, confident but humble, authentic and human
8. **Specificity & KEYWORD COVERAGE**:
   - Identify the most important requirements and technologies from the job description.
   - Explicitly reference several of those key skills / tools / responsibilities in the body paragraphs.
   - When you mention a technology or responsibility from the job description, tie it to a concrete example from the candidate's background (from the resume).
   - Aim for a cover letter that would score highly in an automated keyword scan against this job description, while still reading as natural, human text.

CRITICAL: Return ONLY the cover letter body text. Do NOT include:
- Salutations (e.g., "Dear Hiring Manager,")
- Closings (e.g., "Sincerely," or "Best regards,")
- Your name or signature
- Any preamble or explanation

Start directly with the first paragraph of the cover letter.`;

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are an expert cover letter writer who creates engaging, story-like cover letters that connect candidates to opportunities.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.8,
    });

    let content = response.choices[0]?.message?.content || "";
    
    // Remove any preamble or conversational text
    const preamblePatterns = [
      /^Certainly!.*?\n\n/,
      /^Here is.*?\n\n/,
      /^I'll write.*?\n\n/,
      /^Here's.*?\n\n/,
    ];
    
    for (const pattern of preamblePatterns) {
      content = content.replace(pattern, "");
    }
    
    // Remove salutations and closings if present
    content = content.replace(/^Dear\s+(Hiring Manager|Sir|Madam)[,\s]*\n*/i, "");
    content = content.replace(/\n*(Sincerely|Best regards|Yours truly)[,\s]*\n*[A-Z\s]+\n*$/i, "");
    
    // Remove any markdown code blocks if present
    content = content.replace(/^```[\w]*\n?/gm, "").replace(/```$/gm, "");
    
    return content.trim();
  } catch (error: any) {
    throw new Error(`Failed to generate cover letter: ${error.message}`);
  }
}

export { PROMPT_VERSION };
