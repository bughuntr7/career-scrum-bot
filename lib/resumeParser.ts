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

/** Role header line pattern: "Title | Company | Location | Date" (exactly 3 pipes → 4 parts) */
const WORK_EXPERIENCE_HEADER_PATTERN = /^[^|]+\|[^|]+\|[^|]+\|[^|]+$/;

/** Normalize for comparison: collapse whitespace, normalize dashes so header matching is robust */
function normalizeForHeaderTest(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\u2013|\u2014/g, "-") // en-dash, em-dash → hyphen
    .replace(/\u00A0/g, " ");       // nbsp → space
}

function looksLikeRoleHeader(line: string): boolean {
  const n = normalizeForHeaderTest(line);
  return n.length > 0 && WORK_EXPERIENCE_HEADER_PATTERN.test(n);
}

/**
 * Strip the first line from a work experience block if it is a role header.
 * Use when the template already displays the role title (e.g. "Title | Company | Location | Date")
 * so we only inject bullets and "Technologies & Skills" into the placeholder.
 */
export function stripRoleHeaderLineFromBlock(block: string): string {
  const lines = block.split("\n");
  const firstNonEmptyIndex = lines.findIndex((l) => l.trim().length > 0);
  if (firstNonEmptyIndex < 0) return block.trim();
  const firstNonEmpty = lines[firstNonEmptyIndex].trim();
  if (!looksLikeRoleHeader(lines[firstNonEmptyIndex])) return block.trim();
  const rest = lines.slice(firstNonEmptyIndex + 1);
  return rest.join("\n").trim();
}

/**
 * Remove duplicate role header: if two consecutive non-empty lines both look like
 * role headers, keep only the first. Uses normalized comparison so dashes/spaces don't break it.
 */
function removeDuplicateRoleHeader(block: string): string {
  const lines = block.split("\n");
  const result: string[] = [];
  let lastWasHeader = false;

  for (const line of lines) {
    const t = line.trim();
    const isHeader = Boolean(t && looksLikeRoleHeader(line));

    if (!t) {
      result.push(line);
      lastWasHeader = false;
      continue;
    }
    if (isHeader && lastWasHeader) {
      continue;
    }
    result.push(line);
    lastWasHeader = isHeader;
  }
  return result.join("\n").trim();
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
  const workExperiencePattern = WORK_EXPERIENCE_HEADER_PATTERN;
  const workExperiences: string[] = [];
  let currentExperience: string[] = [];
  let inExperience = false;
  
  for (const line of experienceSection.split("\n")) {
    const trimmed = line.trim();
    if (looksLikeRoleHeader(line)) {
      // Only skip if this is a duplicate of the current block's first line (same job), not a different job
      const firstLine = currentExperience.length > 0 ? currentExperience[0].trim() : "";
      const isDuplicateOfCurrent =
        currentExperience.length > 0 &&
        firstLine &&
        looksLikeRoleHeader(currentExperience[0]) &&
        normalizeForHeaderTest(trimmed) === normalizeForHeaderTest(firstLine);
      if (isDuplicateOfCurrent) {
        continue;
      }
      // New work experience found
      if (currentExperience.length > 0) {
        workExperiences.push(removeDuplicateRoleHeader(currentExperience.join("\n")));
      }
      currentExperience = [line];
      inExperience = true;
    } else if (inExperience && trimmed) {
      currentExperience.push(line);
    }
  }
  if (currentExperience.length > 0) {
    workExperiences.push(removeDuplicateRoleHeader(currentExperience.join("\n")));
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
