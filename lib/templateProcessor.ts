import * as fs from "fs";
import * as path from "path";
import mammoth from "mammoth";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

/**
 * Extract text from a .docx template file
 * This preserves the structure for LLM processing
 */
export async function extractTextFromTemplate(templatePath: string): Promise<string> {
  try {
    const buffer = fs.readFileSync(templatePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error: any) {
    throw new Error(`Failed to extract text from template: ${error.message}`);
  }
}

/**
 * Replace text in a .docx template while preserving all formatting
 * This uses docxtemplater which can replace text while keeping styles
 */
export async function replaceTextInTemplate(
  templatePath: string,
  replacements: Record<string, string>,
  outputPath: string
): Promise<void> {
  try {
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    // Replace placeholders
    doc.setData(replacements);
    doc.render();

    const buffer = doc.getZip().generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    });

    fs.writeFileSync(outputPath, buffer);
  } catch (error: any) {
    throw new Error(`Failed to replace text in template: ${error.message}`);
  }
}

/**
 * Smart text replacement in .docx - finds and replaces text content
 * while preserving formatting
 */
export async function replaceTextContentInDocx(
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
    const docXml = zip.files["word/document.xml"].asText();
    
    // Replace text content (simple approach - replace in XML)
    // This is a basic implementation - for production, you'd want more sophisticated replacement
    const updatedXml = docXml.replace(
      new RegExp(oldText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      newText
    );
    
    zip.file("word/document.xml", updatedXml);
    
    const buffer = zip.generate({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    
    fs.writeFileSync(outputPath, buffer);
  } catch (error: any) {
    throw new Error(`Failed to replace text content: ${error.message}`);
  }
}
