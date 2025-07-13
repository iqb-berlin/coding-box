/**
 * Utility functions for file operations in the ws-admin module
 */

/**
 * Returns the appropriate icon based on file type
 * @param fileType The file type to get an icon for
 * @returns The name of the Material icon to use
 */
export function getFileIcon(fileType: string): string {
  const type = fileType.toLowerCase();
  if (type.includes('xml')) {
    return 'code';
  }
  if (type.includes('zip')) {
    return 'folder_zip';
  }
  if (type.includes('html')) {
    return 'html';
  }
  if (type.includes('csv')) {
    return 'table_chart';
  }
  if (type.includes('voud') || type.includes('vocs')) {
    return 'description';
  }
  return 'insert_drive_file';
}

/**
 * Extracts the unit name from a file name
 * @param fileName The fileName in the format "Unit unitName"
 * @returns The unit name
 */
export function extractUnitName(fileName: string): string {
  // The fileName is in the format "Unit unitName"
  const match = fileName.match(/^Unit\s+(.+)$/);
  return match ? match[1] : fileName;
}
