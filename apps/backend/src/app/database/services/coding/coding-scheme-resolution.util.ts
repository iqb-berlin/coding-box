import { BadRequestException } from '@nestjs/common';
import type { CodingScheme } from '@iqbspecs/coding-scheme';
import * as cheerio from 'cheerio';
import type FileUpload from '../../entities/file_upload.entity';
import { getErrorMessage } from '../../../utils/error.util';

export function extractCodingSchemeRef(data: string): string {
  return cheerio.load(data)('codingSchemeRef').text().trim().toUpperCase();
}

export function getUnitCodingSchemeReference(
  unitId: number,
  unitFileId: string | null,
  testFile: FileUpload | undefined
): string {
  if (!unitFileId) {
    throw new Error(
      `Autocoder cannot resolve the Unit file for unit ${unitId}: missing alias and name.`
    );
  }
  if (!testFile) {
    throw new Error(
      `Autocoder could not find Unit file "${unitFileId}" for unit ${unitId}.`
    );
  }
  try {
    return extractCodingSchemeRef(testFile.data);
  } catch (error) {
    throw new Error(
      'Autocoder could not read the coding scheme reference from Unit file ' +
      `"${testFile.filename}": ${getErrorMessage(error)}`
    );
  }
}

export function requireUsableCodingScheme(
  workspaceId: number,
  codingSchemeRef: string,
  scheme: CodingScheme | undefined
): CodingScheme {
  if (!scheme) {
    throw new Error(
      `Autocoder could not find referenced coding scheme "${codingSchemeRef}" ` +
      `in workspace ${workspaceId}.`
    );
  }
  if (!Array.isArray(scheme.variableCodings) || scheme.variableCodings.length === 0) {
    throw new Error(
      `Referenced coding scheme "${codingSchemeRef}" in workspace ${workspaceId} ` +
      'contains no variable codings.'
    );
  }
  return scheme;
}

export function assertCodingFilesAvailable(
  workspaceId: number,
  missingUnitFiles: string[],
  missingCodingSchemes: string[],
  invalidCodingSchemes: string[]
): void {
  const problems = [
    ...missingUnitFiles.map(id => `Unit file "${id}" is missing.`),
    ...missingCodingSchemes.map(id => `Referenced coding scheme "${id}" is missing.`),
    ...invalidCodingSchemes.map(id => `Referenced coding scheme "${id}" is not usable.`)
  ];
  if (problems.length > 0) {
    throw new BadRequestException(
      `Auto-coding cannot process the selected task files in workspace ${workspaceId}: ${problems.join(' ')}`
    );
  }
}
