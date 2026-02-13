import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import * as fs from "fs";
import * as path from "path";
import Docxtemplater from "docxtemplater";

// Use dynamic imports for libraries that have module compatibility issues
const mammoth = require("mammoth");
const PizZip = require("pizzip");

/**
 * Generate folder name from company and role
 * Format: "Company name+role"
 * Example: "Nextdoor+Senior Machine Learning Engineer"
 */
function generateFolderName(company: string, role: string): string {
  // Clean company name and role
  const cleanCompany = company.replace(/[<>:"/\\|?*]/g, "").trim();
  const cleanRole = role.replace(/[<>:"/\\|?*]/g, "").trim();
  return `${cleanCompany}+${cleanRole}`;
}

/**
 * Convert plain text resume to docx format
 * Preserves structure with headings
 */
function textToDocxParagraphs(text: string): Paragraph[] {
  const lines = text.split("\n");
  const paragraphs: Paragraph[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (!trimmed) {
      // Empty line
      paragraphs.push(new Paragraph({ text: "" }));
      continue;
    }

    // Check if it's a heading (all caps or common resume headings)
    const isHeading = 
      trimmed === trimmed.toUpperCase() && trimmed.length < 50 &&
      (trimmed.includes("SUMMARY") || 
       trimmed.includes("SKILLS") || 
       trimmed.includes("EXPERIENCE") || 
       trimmed.includes("EDUCATION") ||
       trimmed.includes("PROFESSIONAL") ||
       trimmed.match(/^[A-Z\s&]+$/));

    if (isHeading) {
      paragraphs.push(
        new Paragraph({
          text: trimmed,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
        })
      );
    } else {
      paragraphs.push(
        new Paragraph({
          text: trimmed,
          spacing: { after: 120 },
        })
      );
    }
  }

  return paragraphs;
}

/**
 * Convert plain text cover letter to docx format
 */
function coverLetterToDocxParagraphs(text: string): Paragraph[] {
  // Split by double newlines (paragraphs) or single newlines
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  
  return paragraphs.map((para) => {
    const lines = para.split("\n").filter(l => l.trim());
    const runs: TextRun[] = [];
    
    lines.forEach((line, index) => {
      if (index > 0) {
        runs.push(new TextRun({ text: "\n" }));
      }
      runs.push(new TextRun({ text: line.trim() }));
    });

    return new Paragraph({
      children: runs,
      spacing: { after: 240 },
    });
  });
}

/**
 * Extract text from template .docx file for LLM processing
 * Uses mammoth to extract all text content including formatting structure
 * Falls back to text file if .docx extraction is insufficient
 */
export async function extractTextFromResumeTemplate(
  templatePath: string = "Resumes/Templates/Jiayong Lin.docx"
): Promise<string> {
  try {
    const fullPath = path.isAbsolute(templatePath) 
      ? templatePath 
      : path.join(process.cwd(), templatePath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Template file not found: ${fullPath}`);
    }

    const buffer = fs.readFileSync(fullPath);
    
    // Try to extract with formatting preserved
    const result = await mammoth.extractRawText({ buffer });
    let extractedText = result.value;
    
    // If extraction is too short (< 200 chars), try to use text file fallback
    if (extractedText.length < 200) {
      console.warn(`⚠️  Template .docx extraction is short (${extractedText.length} chars).`);
      
      // Try to find a text file version
      const textFilePath = path.join(process.cwd(), "Resumes", "Templates", "base-resume-full.txt");
      if (fs.existsSync(textFilePath)) {
        console.log(`📄 Using full resume text file: ${textFilePath}`);
        extractedText = fs.readFileSync(textFilePath, "utf-8");
        console.log(`✅ Loaded ${extractedText.length} characters from text file`);
      } else {
        console.warn(`   Template may be mostly formatting. Consider creating: ${textFilePath}`);
        console.warn(`   Or ensure your template .docx contains the full resume text content.`);
      }
    }
    
    return extractedText;
  } catch (error: any) {
    throw new Error(`Failed to extract text from template: ${error.message}`);
  }
}

/**
 * Replace text content in .docx template while preserving ALL formatting
 * This is a simplified approach: for production, consider using docxtemplater
 * or a more sophisticated XML manipulation library
 */
async function replaceTextInDocxTemplate(
  templatePath: string,
  oldText: string,
  newText: string,
  outputPath: string
): Promise<void> {
  try {
    // Read the template
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);
    
    // Get the main document XML
    let docXml = zip.files["word/document.xml"].asText();
    
    // Simple approach: replace text content while preserving XML structure
    // Split both texts into lines for better matching
    const oldLines = oldText.split("\n").filter(l => l.trim());
    const newLines = newText.split("\n").filter(l => l.trim());
    
    // For each line in old text, try to find and replace in XML
    // This is a basic implementation - for complex documents, use docxtemplater
    for (let i = 0; i < Math.min(oldLines.length, newLines.length); i++) {
      const oldLine = oldLines[i].trim();
      const newLine = newLines[i].trim();
      
      if (oldLine && newLine && oldLine !== newLine) {
        // Escape XML special characters in old text
        const escapedOld = oldLine
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");
        
        // Escape XML special characters in new text
        const escapedNew = newLine
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");
        
        // Replace in XML (look for text within <w:t> tags)
        // This regex finds text nodes and replaces them
        const regex = new RegExp(
          `(<w:t[^>]*>)([^<]*${escapedOld.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^<]*)(</w:t>)`,
          "gi"
        );
        
        docXml = docXml.replace(regex, (match, openTag, content, closeTag) => {
          // Replace the old text with new text in the content
          const updatedContent = content.replace(escapedOld, escapedNew);
          return openTag + updatedContent + closeTag;
        });
      }
    }
    
    zip.file("word/document.xml", docXml);
    
    const buffer = zip.generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    
    fs.writeFileSync(outputPath, buffer);
    console.log(`✅ Text replaced in template while preserving formatting`);
  } catch (error: any) {
    // Fallback: just copy the template if replacement fails
    console.warn(`⚠️  Text replacement failed (${error.message}), copying template as-is`);
    console.warn(`   You may need to manually update the content in the generated file`);
    fs.copyFileSync(templatePath, outputPath);
  }
}

/**
 * Copy styles from template document
 */
async function copyStylesFromTemplate(templatePath: string, zip: PizZip): Promise<void> {
  try {
    const templateContent = fs.readFileSync(templatePath, "binary");
    const templateZip = new PizZip(templateContent);
    
    // Copy styles.xml to preserve formatting
    if (templateZip.files["word/styles.xml"]) {
      const stylesXml = templateZip.files["word/styles.xml"].asText();
      zip.file("word/styles.xml", stylesXml);
    }
    
    // Copy theme and other style-related files
    if (templateZip.files["word/theme/theme1.xml"]) {
      const themeXml = templateZip.files["word/theme/theme1.xml"].asText();
      if (!zip.files["word/theme"]) {
        zip.folder("word/theme");
      }
      zip.file("word/theme/theme1.xml", themeXml);
    }
  } catch (error) {
    console.warn("⚠️  Could not copy styles from template:", error);
  }
}

/**
 * Replace multiple placeholders in template using Docxtemplater
 * Preserves ALL visual formatting including boxes, colors, alignment
 */
async function replacePlaceholdersInTemplate(
  templatePath: string,
  placeholders: Record<string, string>,
  outputPath: string
): Promise<void> {
  try {
    // Read the template
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);
    
    // Create docxtemplater instance
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: {
        start: "{",
        end: "}",
      },
    });
    
    // Set the data to replace all placeholders
    doc.setData(placeholders);
    
    // Render the document (replace placeholders)
    doc.render();
    
    // Generate the output
    const buffer = doc.getZip().generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    
    // Save the result
    fs.writeFileSync(outputPath, buffer);
    
    const placeholderNames = Object.keys(placeholders).join(", ");
    console.log(`✅ Replaced placeholders: ${placeholderNames}`);
    console.log(`   All template formatting preserved (blue boxes, colors, alignment, etc.)`);
  } catch (error: any) {
    if (error.properties && error.properties.errors instanceof Array) {
      const errorMessages = error.properties.errors
        .map((e: any) => e.properties?.explanation || e.message)
        .join(", ");
      throw new Error(`Docxtemplater error: ${errorMessages}`);
    }
    throw new Error(`Failed to replace placeholders: ${error.message}`);
  }
}

/**
 * Generate and save resume as .docx file using styled template
 * Uses Docxtemplater to replace multiple placeholders while preserving ALL formatting
 * Template placeholders: {summaryContent}, {skillsContent}, {workExperience1Content}, etc.
 */
export async function saveResumeAsDocx(
  parsedResume: {
    summary: string;
    skills: string;
    workExperiences: string[];
    education?: string; // Education is preserved in template, not replaced
  },
  company: string,
  role: string,
  outputDir: string = "Resumes",
  templatePath?: string
): Promise<string> {
  const folderName = generateFolderName(company, role);
  const folderPath = path.join(outputDir, folderName);
  
  // Create folder if it doesn't exist
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const fileName = "Jiayong Lin.docx";
  const filePath = path.join(folderPath, fileName);

  const resumeTemplatePath = templatePath || path.join(process.cwd(), "Resumes", "Templates", "Jiayong Lin.docx");
  
  if (fs.existsSync(resumeTemplatePath)) {
    try {
      // Prepare placeholders data
      const placeholders: Record<string, string> = {
        summaryContent: parsedResume.summary,
        skillsContent: parsedResume.skills,
      };
      
      // Add work experience placeholders (up to 4)
      for (let i = 0; i < Math.min(parsedResume.workExperiences.length, 4); i++) {
        placeholders[`workExperience${i + 1}Content`] = parsedResume.workExperiences[i];
      }
      
      // Use Docxtemplater to replace all placeholders
      // This preserves ALL formatting including blue boxes, colors, alignment, etc.
      await replacePlaceholdersInTemplate(
        resumeTemplatePath,
        placeholders,
        filePath
      );
      
      console.log(`✅ Saved resume with full template formatting preserved: ${filePath}`);
    } catch (error: any) {
      // If placeholders not found, fallback to copying template
      if (error.message.includes("not found") || error.message.includes("Docxtemplater error")) {
        console.warn(`⚠️  Error replacing placeholders: ${error.message}`);
        console.warn(`   Falling back to copying template...`);
        fs.copyFileSync(resumeTemplatePath, filePath);
      } else {
        throw error;
      }
    }
  } else {
    // No template, create new document
    console.warn(`⚠️  Template not found at ${resumeTemplatePath}, creating basic document`);
    const fullText = [
      parsedResume.summary,
      parsedResume.skills,
      ...parsedResume.workExperiences,
    ].join("\n\n");
    
    const paragraphs = textToDocxParagraphs(fullText);
    const doc = new Document({
      sections: [
        {
          children: paragraphs,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
  }

  return filePath;
}

/**
 * Generate and save cover letter as .docx file using styled template
 * Uses Docxtemplater to replace {coverLetterContent} placeholder while preserving ALL formatting
 */
export async function saveCoverLetterAsDocx(
  coverLetterText: string,
  company: string,
  role: string,
  outputDir: string = "Resumes",
  templatePath?: string
): Promise<string> {
  const folderName = generateFolderName(company, role);
  const folderPath = path.join(outputDir, folderName);
  
  // Create folder if it doesn't exist
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const fileName = "Cover Letter.docx";
  const filePath = path.join(folderPath, fileName);

  const coverLetterTemplatePath = templatePath || path.join(process.cwd(), "Resumes", "Templates", "Cover Letter.docx");
  
  if (fs.existsSync(coverLetterTemplatePath)) {
    try {
      // Use Docxtemplater to replace placeholder
      // Template uses {coverletterContent} (lowercase 'l'), so we need to match it exactly
      await replacePlaceholdersInTemplate(
        coverLetterTemplatePath,
        { coverletterContent: coverLetterText }, // Match template placeholder exactly
        filePath
      );
      
      console.log(`✅ Saved cover letter with full template formatting preserved: ${filePath}`);
    } catch (error: any) {
      // If placeholder not found, fallback to copying template
      if (error.message.includes("coverletterContent") || error.message.includes("not found")) {
        console.warn(`⚠️  Placeholder {coverletterContent} not found in template.`);
        console.warn(`   Please add {coverletterContent} to your template where you want the cover letter content.`);
        console.warn(`   Falling back to copying template...`);
        fs.copyFileSync(coverLetterTemplatePath, filePath);
      } else {
        throw error;
      }
    }
  } else {
    // No template, create new document
    console.warn(`⚠️  Template not found at ${coverLetterTemplatePath}, creating basic document`);
    const paragraphs = coverLetterToDocxParagraphs(coverLetterText);
    const doc = new Document({
      sections: [
        {
          children: paragraphs,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(filePath, buffer);
  }

  return filePath;
}

/**
 * Save job description as .txt file
 */
export async function saveJobDescriptionAsTxt(
  jobDescription: string,
  company: string,
  role: string,
  outputDir: string = "Resumes"
): Promise<string> {
  const folderName = generateFolderName(company, role);
  const folderPath = path.join(outputDir, folderName);
  
  // Create folder if it doesn't exist
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const fileName = "job description.txt";
  const filePath = path.join(folderPath, fileName);

  fs.writeFileSync(filePath, jobDescription, "utf-8");

  return filePath;
}
