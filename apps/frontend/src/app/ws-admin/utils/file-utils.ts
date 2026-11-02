import { UiTranslator } from '../../shared/utils/ui-translator';
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

/**
 * Returns a localized (German) label for a file type.
 * @param fileType The file type to localize
 * @returns German label if known, otherwise the original value
 */
export function getFileTypeLabel(translate: UiTranslator, fileType: string): string {
  const normalized = (fileType || '').trim();
  const resourceSubtypeMatch = normalized.match(/^Resource\s*\(\s*(\.[^)]+?)\s*\)$/i);
  if (resourceSubtypeMatch) {
    return translate('ui-text.file-utils.ressource', { value1: resourceSubtypeMatch[1].trim().toLowerCase() });
  }
  const mapping: Record<string, string> = {
    Resource: translate('ui-text.file-utils.ressource-23ef58'),
    Unit: translate('coding.jobs.table.units'),
    Booklet: translate('ui-text.files-validation.testhefte'),
    TestTakers: translate('ui-text.file-utils.testteilnehmer'),
    Testtakers: translate('ui-text.file-utils.testteilnehmer'),
    Schemer: translate('ui-text.files-validation.schemer'),
    SysCheck: translate('ui-text.file-utils.systemcheck')
  };
  return mapping[normalized] ?? normalized;
}
