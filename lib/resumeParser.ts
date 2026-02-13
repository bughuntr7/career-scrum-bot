/**
 * Parse resume text into structured sections
 */
export interface ParsedResume {
  header: string; // Name, title, contact info
  summary: string;
  skills: string;
  workExperiences: string[]; // Array of work experience content
  education: string;
}

/**
 * Extract and parse resume content from sample file
 */
export function parseResumeText(resumeText: string): ParsedResume {
  const lines = resumeText.split("\n");
  
  // Extract header (everything before SUMMARY)
  const summaryIndex = lines.findIndex(line => /^SUMMARY\s*$/i.test(line.trim()));
  const header = lines.slice(0, summaryIndex).join("\n").trim();
  
  // Extract SUMMARY
  const skillsIndex = lines.findIndex(line => /^SKILLS\s*$/i.test(line.trim()));
  const summary = lines.slice(summaryIndex + 1, skillsIndex)
    .filter(line => line.trim())
    .join("\n")
    .trim();
  
  // Extract SKILLS
  const experienceIndex = lines.findIndex(line => /^PROFESSIONAL EXPERIENCE\s*$/i.test(line.trim()));
  const skills = lines.slice(skillsIndex + 1, experienceIndex)
    .filter(line => line.trim())
    .join("\n")
    .trim();
  
  // Extract work experiences
  const educationIndex = lines.findIndex(line => /^EDUCATION\s*$/i.test(line.trim()));
  const experienceSection = lines.slice(experienceIndex + 1, educationIndex)
    .join("\n");
  
  // Split work experiences by job title patterns (e.g., "Machine Learning Engineer | Meta")
  const workExperiencePattern = /^([^|]+\|[^|]+\|[^|]+\|[^|]+)$/;
  const workExperiences: string[] = [];
  let currentExperience: string[] = [];
  let inExperience = false;
  
  for (const line of experienceSection.split("\n")) {
    if (workExperiencePattern.test(line.trim())) {
      // New work experience found
      if (currentExperience.length > 0) {
        workExperiences.push(currentExperience.join("\n").trim());
      }
      currentExperience = [line];
      inExperience = true;
    } else if (inExperience && line.trim()) {
      currentExperience.push(line);
    }
  }
  if (currentExperience.length > 0) {
    workExperiences.push(currentExperience.join("\n").trim());
  }
  
  // Extract EDUCATION (everything after EDUCATION header)
  const education = lines.slice(educationIndex + 1)
    .filter(line => line.trim())
    .join("\n")
    .trim();
  
  return {
    header,
    summary,
    skills,
    workExperiences,
    education,
  };
}
