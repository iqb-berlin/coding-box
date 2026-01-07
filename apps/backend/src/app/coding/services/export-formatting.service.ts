import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { ResponseEntity } from '../../common';
import { CodingJobUnit } from '../entities/coding-job-unit.entity';

@Injectable()
export class ExportFormattingService {
  getLatestCode(response: ResponseEntity): { code: number | null; score: number | null; version: string } {
    // Priority: v3 > v2 > v1
    if (response.code_v3 !== null && response.code_v3 !== undefined) {
      return { code: response.code_v3, score: response.score_v3, version: 'v3' };
    }
    if (response.code_v2 !== null && response.code_v2 !== undefined) {
      return { code: response.code_v2, score: response.score_v2, version: 'v2' };
    }
    return { code: response.code_v1, score: response.score_v1, version: 'v1' };
  }

  generateUniqueWorksheetName(workbook: ExcelJS.Workbook, baseName: string): string {
    // Clean the base name and limit to 20 characters initially
    // First decode any URL encoding, then replace special characters with underscores
    let cleanName = decodeURIComponent(baseName).replace(/[^a-zA-Z0-9\s\-_]/g, '_').substring(0, 20).trim();

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

  buildCoderNameMapping(coders: string[], usePseudo: boolean): Map<string, string> {
    const mapping = new Map<string, string>();

    if (usePseudo) {
      // For pseudo mode: always use K1 and K2 for any pair of coders
      // Sort alphabetically for deterministic assignment
      const sortedCoders = [...coders].sort();
      sortedCoders.forEach((coder, index) => {
        mapping.set(coder, `K${index + 1}`);
      });
    } else {
      // For regular anonymization: shuffle and assign K1, K2, K3, etc.
      const shuffledCoders = [...coders].sort(() => Math.random() - 0.5);
      shuffledCoders.forEach((coder, index) => {
        mapping.set(coder, `K${index + 1}`);
      });
    }

    return mapping;
  }

  buildCoderMapping(codingJobUnits: CodingJobUnit[], usePseudo = false): Map<string, string> {
    const coders = new Set<string>();
    for (const unit of codingJobUnits) {
      const coderName = unit.coding_job?.codingJobCoders?.[0]?.user?.username || `Job ${unit.coding_job_id}`;
      coders.add(coderName);
    }

    return this.buildCoderNameMapping(Array.from(coders), usePseudo);
  }

  calculateModalValue(codes: number[]): { modalValue: number; deviationCount: number } {
    if (!codes || codes.length === 0) {
      return { modalValue: 0, deviationCount: 0 };
    }

    const counts = new Map<number, number>();
    let maxCount = 0;
    let modalValue = codes[0];

    for (const code of codes) {
      const count = (counts.get(code) || 0) + 1;
      counts.set(code, count);
      if (count > maxCount) {
        maxCount = count;
        modalValue = code;
      } else if (count === maxCount) {
        // If there's a tie, we keep the first one found or we could have more complex logic
        // Current implementation matches original behavior
      }
    }

    const deviationCount = codes.length - maxCount;

    return { modalValue, deviationCount };
  }

  getCodingIssueText(issueOption: number | null): string {
    if (!issueOption) return '';
    const issueTexts: { [key: number]: string } = {
      1: 'Code-Vergabe unsicher',
      2: 'Neuer Code nötig',
      3: 'Ungültig (Spaßantwort)',
      4: 'Technische Probleme'
    };
    return issueTexts[issueOption] || '';
  }
}
