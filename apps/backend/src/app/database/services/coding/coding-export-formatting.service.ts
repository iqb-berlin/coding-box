import { Injectable, Optional } from '@nestjs/common';
import { formatModalCandidates, mapCodeForExport, type ModalValueResult } from '../../../utils/coding-utils';
import { MissingsProfilesService, ResolvedMissingValue } from './missings-profiles.service';
import { AggregatedMostFrequentCoding } from './coding-export.types';

@Injectable()
export class CodingExportFormattingService {
  private readonly manualMissingExportValueCache = new Map<string, ResolvedMissingValue>();

  constructor(
    @Optional()
    private missingsProfilesService?: MissingsProfilesService
  ) {}

  private async getManualMissingExportValue(
    workspaceId: number,
    code: number | null | undefined,
    profileId?: number | null
  ): Promise<ResolvedMissingValue | null> {
    let missingId: 'mir' | 'mci' | null = null;
    if (code === -3) {
      missingId = 'mir';
    }
    if (code === -4) {
      missingId = 'mci';
    }
    if (!missingId || !this.missingsProfilesService) {
      return null;
    }

    const cacheKey = `${workspaceId}:${profileId ?? 'default'}:${missingId}`;
    const cached = this.manualMissingExportValueCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const missing = await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
      workspaceId,
      profileId,
      missingId
    );
    this.manualMissingExportValueCache.set(cacheKey, missing);
    return missing;
  }

  async mapCodeAndScoreForExport(
    workspaceId: number,
    code: number | null | undefined,
    score: number | null | undefined,
    profileId?: number | null
  ): Promise<{ code: number | null; score: number | null }> {
    const manualMissing = await this.getManualMissingExportValue(workspaceId, code, profileId);
    if (manualMissing) {
      return {
        code: manualMissing.code,
        score: manualMissing.score
      };
    }

    return {
      code: mapCodeForExport(code),
      score: score ?? null
    };
  }

  formatScoreForExport(code: number | null | undefined, score: number | null | undefined): number | string {
    if (score !== null && score !== undefined) {
      return score;
    }

    return code !== null && code !== undefined && code < 0 ? 'NA' : '';
  }

  escapeCsvField(field: unknown): string {
    return `"${field?.toString().replace(/"/g, '""') || ''}"`;
  }

  private normalizeCodingIssueOption(issueOption: number | null | undefined): number | null {
    if (issueOption === null || issueOption === undefined || issueOption === 0) {
      return null;
    }
    const normalized = Math.abs(issueOption);
    return [1, 2, 3, 4].includes(normalized) ? normalized : null;
  }

  getCodingIssueText(issueOption: number | null | undefined): string {
    const normalized = this.normalizeCodingIssueOption(issueOption);
    if (normalized === null) {
      return '';
    }
    const issueTexts: Record<number, string> = {
      1: 'Code-Vergabe unsicher',
      2: 'Neuer Code nötig',
      3: 'Ungültig (Spaßantwort)',
      4: 'Technische Probleme'
    };
    return issueTexts[normalized] || '';
  }

  private getCodingIssueSuffix(issueOption: number | null | undefined): string {
    const normalized = this.normalizeCodingIssueOption(issueOption);
    if (normalized === null) {
      return '';
    }
    const issueSuffixes: Record<number, string> = {
      1: 'unsicher',
      2: 'neuer Code nötig',
      3: 'ungültig',
      4: 'technische Probleme'
    };
    return issueSuffixes[normalized] || '';
  }

  formatCodeWithIssueSuffix(code: number | null | undefined, issueOption: number | null | undefined): string {
    const mappedCode = mapCodeForExport(code);
    if (mappedCode === null) {
      return '';
    }
    const issueSuffix = this.getCodingIssueSuffix(issueOption);
    if (!issueSuffix) {
      return mappedCode.toString();
    }
    return `${mappedCode} (${issueSuffix})`;
  }

  formatCodeWithIssueSuffixes(
    code: number | null | undefined,
    issueOptions: number[]
  ): string {
    const mappedCode = mapCodeForExport(code);
    if (mappedCode === null) {
      return '';
    }

    const issueSuffixes = issueOptions
      .map(issueOption => this.getCodingIssueSuffix(issueOption))
      .filter(Boolean);
    if (issueSuffixes.length === 0) {
      return mappedCode.toString();
    }

    return `${mappedCode} (${issueSuffixes.join('; ')})`;
  }

  formatModalCandidatesWithIssueSuffixes(
    modal: ModalValueResult | null | undefined,
    codings: AggregatedMostFrequentCoding[]
  ): string {
    return formatModalCandidates(modal, code => this.formatCodeWithIssueSuffixes(
      code,
      this.getCodingIssueOptionsForModalCode(codings, code)
    ));
  }

  getMostFrequentModalTieHeader(variable: string): string {
    return `${variable} Modalwert-Gleichstand`;
  }

  getMostFrequentModalCandidatesHeader(variable: string): string {
    return `${variable} Modalwert-Kandidaten`;
  }

  getCodingIssueOptionsForModalCode(
    codings: AggregatedMostFrequentCoding[],
    modalCode: number | null | undefined
  ): number[] {
    if (modalCode === null || modalCode === undefined) {
      return [];
    }

    const normalizedIssueOptions = new Set<number>();
    codings.forEach(coding => {
      if (coding.code !== modalCode) {
        return;
      }
      const normalizedIssueOption = this.normalizeCodingIssueOption(coding.codingIssueOption);
      if (normalizedIssueOption !== null) {
        normalizedIssueOptions.add(normalizedIssueOption);
      }
    });

    return Array.from(normalizedIssueOptions).sort((a, b) => a - b);
  }

  toIntegerOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    return Number.isInteger(parsed) ? parsed : null;
  }
}
