import * as ExcelJS from 'exceljs';

/**
 * Generates a unique worksheet name within a workbook by appending a counter if necessary.
 * Excel has a 31-character limit for sheet names.
 *
 * @param workbook - The workbook to check existing sheet names against
 * @param baseName - The desired base name for the worksheet
 * @returns A unique worksheet name (max 31 chars)
 */
export function generateUniqueWorksheetName(
  workbook: ExcelJS.Workbook,
  baseName: string
): string {
  // Clean the base name and limit to 20 characters initially
  // First decode any URL encoding, then replace special characters with underscores
  let cleanName = decodeURIComponent(baseName)
    .replace(/[^a-zA-Z0-9\s\-_]/g, '_')
    .substring(0, 20)
    .trim();

  // If empty after cleaning, use a default
  if (!cleanName) {
    cleanName = 'Sheet';
  }

  let finalName = cleanName;
  let counter = 1;

  // Keep trying until we find a unique name
  while (workbook.getWorksheet(finalName)) {
    const suffix = `_${counter}`;
    const availableLength = 31 - suffix.length; // Excel limit is 31 chars
    finalName = cleanName.substring(0, availableLength) + suffix;
    counter += 1;

    // Safety check to prevent infinite loop
    if (counter > 1000) {
      finalName = `Sheet_${Date.now()}`;
      break;
    }
  }

  return finalName;
}
