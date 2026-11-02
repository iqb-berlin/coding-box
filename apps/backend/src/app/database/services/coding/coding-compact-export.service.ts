import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Request } from 'express';
import {
  calculateModalValue, formatModalCandidates, getCurrentManualCoding, getModalTieLabel, buildCoderNameMapping, mapCodeForExport
} from '../../../utils/coding-utils';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { applyResolvedExclusionsToQuery, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { toManualCodingVariablePairKey } from '../../utils/manual-coding-candidate.util';
import { CompactByVariableRawRow, TrainingDiscussionExportResult, CompactByVariableGroup } from './coding-export.types';
import { isLaterCoding } from './coding-export.util';
import { CodingExportQueryService } from './coding-export-query.service';
import { CodingExportFormattingService } from './coding-export-formatting.service';
import { CodingExportReplayService } from './coding-export-replay.service';

@Injectable()
export class CodingCompactExportService {
  private readonly logger = new Logger(CodingCompactExportService.name);

  constructor(
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    private workspaceExclusionService: WorkspaceExclusionService,
    private readonly query: CodingExportQueryService,
    private readonly formatting: CodingExportFormattingService,
    private readonly replay: CodingExportReplayService
  ) {}

  exportCodingResultsByVariableCompactAsCsvStream(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Readable {
    return Readable.from(this.generateCodingResultsByVariableCompactCsv(
      workspaceId,
      includeModalValue,
      includeDoubleCoded,
      includeComments,
      outputCommentsInsteadOfCodes,
      includeReplayUrl,
      anonymizeCoders,
      usePseudoCoders,
      authToken,
      req,
      excludeAutoCoded,
      checkCancellation,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds,
      serverUrl
    ));
  }

  async exportCodingResultsByVariableCompact(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Promise<Buffer> {
    const stream = this.exportCodingResultsByVariableCompactAsCsvStream(
      workspaceId,
      includeModalValue,
      includeDoubleCoded,
      includeComments,
      outputCommentsInsteadOfCodes,
      includeReplayUrl,
      anonymizeCoders,
      usePseudoCoders,
      authToken,
      req,
      excludeAutoCoded,
      checkCancellation,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds,
      serverUrl
    );

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', chunk => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf-8'));
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private async* generateCodingResultsByVariableCompactCsv(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): AsyncGenerator<string> {
    this.logger.log(`Exporting compact coding results by variable for workspace ${workspaceId}${excludeAutoCoded ? ' (manual coding only)' : ''}${includeModalValue ? ' with modal value' : ''}${includeDoubleCoded ? ' with double coding indicator' : ''}${includeComments ? ' with comments' : ''}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}`);

    this.replay.clearPageMapsCache();
    const {
      jobDefinitionIds: normalizedJobDefinitionIds,
      coderTrainingIds: normalizedCoderTrainingIds,
      coderIds: normalizedCoderIds
    } = this.query.normalizeJobFilters(
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    const hasScopedJobFilters = this.query.hasScopedJobFilters(
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );
    const BATCH_SIZE = 1000;

    if (checkCancellation) await checkCancellation();

    const manualCodingVariableSet = excludeAutoCoded ?
      await this.query.getManualCodingVariableSet(
        workspaceId,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds
      ) :
      null;
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const globalCoderMapping = await this.getCompactByVariableCoderMapping(
      workspaceId,
      anonymizeCoders,
      usePseudoCoders,
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );

    yield this.buildCompactByVariableHeader(
      includeComments,
      includeModalValue,
      includeDoubleCoded,
      includeReplayUrl
    );

    let exportedRowCount = 0;
    let currentGroup: CompactByVariableGroup | null = null;
    let offset = 0;

    while (true) {
      if (checkCancellation) await checkCancellation();

      const dataQueryBuilder = this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .innerJoin('cju.response', 'resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .leftJoin('cj.codingJobCoders', 'cjc')
        .leftJoin('cjc.user', 'user')
        .select('cju.id', 'cjuId')
        .addSelect('unit.name', 'unitName')
        .addSelect('resp.variableid', 'variableId')
        .addSelect('person.login', 'login')
        .addSelect('person.code', 'personCode')
        .addSelect('person.group', 'personGroup')
        .addSelect('bookletinfo.name', 'bookletName')
        .addSelect('cju.code', 'cju_code')
        .addSelect('cju.coding_issue_option', 'coding_issue_option')
        .addSelect('cju.updated_at', 'updatedAt')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('resp.autocoder_invalidated_version', 'autocoder_invalidated_version')
        .addSelect('resp.status_v1', 'status_v1')
        .addSelect('user.username', 'username')
        .addSelect('cju.notes', 'notes')
        .addSelect('person.id', 'pId')
        .addSelect('cj.training_id', 'trainingId')
        .addSelect('cj.missings_profile_id', 'missingsProfileId')
        .addSelect('cju.response_id', 'responseId')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('cj.workspace_id = :workspaceId', { workspaceId });

      applyResolvedExclusionsToQuery(dataQueryBuilder, exclusions, {
        unitAlias: 'unit',
        bookletInfoAlias: 'bookletinfo',
        parameterPrefix: 'variableCompactRows'
      });

      this.query.applyJobFilters(
        dataQueryBuilder,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        'cju'
      );
      if (normalizedCoderTrainingIds.length === 0) {
        dataQueryBuilder.andWhere('cj.training_id IS NULL');
      }
      this.query.applySelectedCoderJoinFilter(dataQueryBuilder, normalizedCoderIds);

      const rows = await dataQueryBuilder
        .orderBy('unit.name', 'ASC')
        .addOrderBy('resp.variableid', 'ASC')
        .addOrderBy('person.id', 'ASC')
        .addOrderBy('user.username', 'ASC')
        .addOrderBy('cju.updated_at', 'ASC')
        .addOrderBy('cju.id', 'ASC')
        .offset(offset)
        .limit(BATCH_SIZE)
        .getRawMany<CompactByVariableRawRow>();

      if (rows.length === 0) {
        break;
      }

      const discussionResultMap = normalizedCoderTrainingIds.length > 0 ?
        await this.query.getTrainingDiscussionResultsMap(
          workspaceId,
          normalizedCoderTrainingIds,
          Array.from(new Set(
            rows
              .map(row => this.formatting.toIntegerOrNull(row.responseId))
              .filter((responseId): responseId is number => responseId !== null)
          ))
        ) :
        new Map<string, TrainingDiscussionExportResult>();

      for (const row of rows) {
        if (
          manualCodingVariableSet &&
          !manualCodingVariableSet.has(toManualCodingVariablePairKey(row.unitName, row.variableId))
        ) {
          continue;
        }
        const groupKey = this.getCompactByVariableGroupKey(row);
        if (currentGroup && currentGroup.key !== groupKey) {
          const renderedGroup = await this.renderCompactByVariableGroup(
            currentGroup,
            includeModalValue,
            includeDoubleCoded,
            includeComments,
            outputCommentsInsteadOfCodes,
            includeReplayUrl,
            anonymizeCoders,
            usePseudoCoders,
            globalCoderMapping,
            authToken,
            req,
            serverUrl,
            workspaceId
          );
          exportedRowCount += renderedGroup.rowCount;
          if (renderedGroup.csv) yield renderedGroup.csv;
          currentGroup = null;
        }

        if (!currentGroup) {
          currentGroup = this.createCompactByVariableGroup(row, groupKey);
        }

        await this.addCompactCodingToGroup(currentGroup, row, workspaceId);
        this.addCompactDiscussionToGroup(currentGroup, row, discussionResultMap);
      }

      offset += rows.length;
    }

    if (currentGroup) {
      const renderedGroup = await this.renderCompactByVariableGroup(
        currentGroup,
        includeModalValue,
        includeDoubleCoded,
        includeComments,
        outputCommentsInsteadOfCodes,
        includeReplayUrl,
        anonymizeCoders,
        usePseudoCoders,
        globalCoderMapping,
        authToken,
        req,
        serverUrl,
        workspaceId
      );
      exportedRowCount += renderedGroup.rowCount;
      if (renderedGroup.csv) yield renderedGroup.csv;
    }

    if (exportedRowCount === 0) {
      throw new Error(this.query.getNoCodingResultsMessage(hasScopedJobFilters));
    }

    this.logger.log(`Exported compact by-variable results for workspace ${workspaceId}`);
  }

  private buildCompactByVariableHeader(
    includeComments: boolean,
    includeModalValue: boolean,
    includeDoubleCoded: boolean,
    includeReplayUrl: boolean
  ): string {
    const headerColumns = [
      'Unit',
      'Variable',
      'Test Person Login',
      'Test Person Code',
      'Test Person Group',
      'Kodierer',
      'Code',
      'Kodierzeitpunkt',
      'Code-Hinweis'
    ];
    if (includeComments) headerColumns.splice(7, 0, 'Kommentar');
    if (includeModalValue) {
      headerColumns.push(
        'Häufigster Wert',
        'Anzahl der Abweichungen',
        'Modalwert-Gleichstand',
        'Modalwert-Kandidaten'
      );
    }
    if (includeDoubleCoded) headerColumns.push('Doppelkodierung');
    if (includeReplayUrl) headerColumns.push('Replay URL');
    return `${headerColumns.map(h => this.formatting.escapeCsvField(h)).join(';')}\n`;
  }

  private async getCompactByVariableCoderMapping(
    workspaceId: number,
    anonymizeCoders: boolean,
    usePseudoCoders: boolean,
    jobDefinitionIds: number[],
    coderTrainingIds: number[],
    coderIds: number[]
  ): Promise<Map<string, string> | null> {
    if (!anonymizeCoders || usePseudoCoders) {
      return null;
    }

    const coderQueryBuilder = this.codingJobRepository.createQueryBuilder('cj')
      .innerJoin('cj.codingJobCoders', 'cjc')
      .innerJoin('cjc.user', 'user')
      .select('user.username', 'username')
      .where('cj.workspace_id = :workspaceId', { workspaceId });

    this.query.applyJobFilters(
      coderQueryBuilder,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    if (coderTrainingIds.length === 0) {
      coderQueryBuilder.andWhere('cj.training_id IS NULL');
    }
    this.query.applySelectedCoderJoinFilter(coderQueryBuilder, coderIds);

    const coderRows = await coderQueryBuilder
      .groupBy('user.username')
      .getRawMany<{ username: string }>();
    const coderNames = new Set(coderRows.map(row => row.username).filter(Boolean));

    if (coderTrainingIds.length > 0) {
      const managerNames = await this.query.getTrainingManagerUsernames(workspaceId, coderTrainingIds);
      managerNames.forEach(managerName => coderNames.add(managerName));
    }

    return buildCoderNameMapping(Array.from(coderNames).sort(), false);
  }

  private getCompactByVariableGroupKey(row: CompactByVariableRawRow): string {
    return [
      row.unitName || '',
      row.variableId || '',
      row.pId?.toString() || ''
    ].join('\u001F');
  }

  private createCompactByVariableGroup(
    row: CompactByVariableRawRow,
    key: string
  ): CompactByVariableGroup {
    return {
      key,
      unitName: row.unitName || '',
      variableId: row.variableId || '',
      login: row.login || '',
      personCode: row.personCode || '',
      personGroup: row.personGroup || '',
      bookletName: row.bookletName || '',
      codings: new Map()
    };
  }

  private async addCompactCodingToGroup(
    group: CompactByVariableGroup,
    row: CompactByVariableRawRow,
    workspaceId: number
  ): Promise<void> {
    if (!row.username) return;

    const rawCode = getCurrentManualCoding(row, {
      code: row.cju_code
    }).code;
    const parsedCode = this.formatting.toIntegerOrNull(rawCode);
    const mapped = await this.formatting.mapCodeAndScoreForExport(
      workspaceId,
      parsedCode,
      null,
      this.formatting.toIntegerOrNull(row.missingsProfileId)
    );
    const coding = {
      code: mapped.code,
      notes: row.notes || null,
      codingIssueOption: this.formatting.toIntegerOrNull(row.coding_issue_option),
      updatedAt: row.updatedAt || null
    };
    const existingCoding = group.codings.get(row.username);
    if (!existingCoding || isLaterCoding(coding.updatedAt, existingCoding.updatedAt)) {
      group.codings.set(row.username, coding);
    }
  }

  private addCompactDiscussionToGroup(
    group: CompactByVariableGroup,
    row: CompactByVariableRawRow,
    discussionResultMap: Map<string, TrainingDiscussionExportResult>
  ): void {
    const trainingId = this.formatting.toIntegerOrNull(row.trainingId);
    const responseId = this.formatting.toIntegerOrNull(row.responseId);
    if (trainingId === null || responseId === null) return;

    const discussion = discussionResultMap.get(`${trainingId}|${responseId}`);
    if (!discussion?.managerUsername || group.codings.has(discussion.managerUsername)) return;

    group.codings.set(discussion.managerUsername, {
      code: mapCodeForExport(discussion.code),
      notes: discussion.notes,
      codingIssueOption: null,
      updatedAt: discussion.updatedAt
    });
  }

  private async renderCompactByVariableGroup(
    group: CompactByVariableGroup,
    includeModalValue: boolean,
    includeDoubleCoded: boolean,
    includeComments: boolean,
    outputCommentsInsteadOfCodes: boolean,
    includeReplayUrl: boolean,
    anonymizeCoders: boolean,
    usePseudoCoders: boolean,
    globalCoderMapping: Map<string, string> | null,
    authToken: string,
    req: Request | undefined,
    serverUrl: string | undefined,
    workspaceId: number
  ): Promise<{ csv: string; rowCount: number }> {
    const codingEntries = Array.from(group.codings.entries())
      .sort(([a], [b]) => a.localeCompare(b));
    if (codingEntries.length === 0) {
      return { csv: '', rowCount: 0 };
    }

    const codes = codingEntries
      .map(([, coding]) => coding.code)
      .filter((code): code is number => code !== null && code !== undefined);
    const modal = includeModalValue ? calculateModalValue(codes) : null;
    const pseudoCoderMapping = anonymizeCoders && usePseudoCoders ?
      buildCoderNameMapping(codingEntries.map(([coderName]) => coderName), true) :
      null;
    const replayUrl = includeReplayUrl && (req || serverUrl) ?
      await this.replay.generateReplayUrlWithPageLookup(
        req,
        group.login,
        group.personCode,
        group.personGroup,
        group.bookletName,
        group.unitName,
        group.variableId,
        workspaceId,
        authToken,
        serverUrl
      ) :
      '';
    let csv = '';

    codingEntries.forEach(([coderName, coding]) => {
      const displayCoderName = pseudoCoderMapping?.get(coderName) ||
        globalCoderMapping?.get(coderName) ||
        coderName;
      const codeValue = outputCommentsInsteadOfCodes ?
        coding.notes || '' :
        this.formatting.formatCodeWithIssueSuffix(coding.code, coding.codingIssueOption);
      const timestamp = coding.updatedAt ?
        new Date(coding.updatedAt).toLocaleString('de-DE').replace(',', '') :
        '';
      const rowFields = [
        this.formatting.escapeCsvField(group.unitName),
        this.formatting.escapeCsvField(group.variableId),
        this.formatting.escapeCsvField(group.login),
        this.formatting.escapeCsvField(group.personCode),
        this.formatting.escapeCsvField(group.personGroup),
        this.formatting.escapeCsvField(displayCoderName),
        this.formatting.escapeCsvField(codeValue)
      ];
      if (includeComments) rowFields.push(this.formatting.escapeCsvField(coding.notes || ''));
      rowFields.push(
        this.formatting.escapeCsvField(timestamp),
        this.formatting.escapeCsvField(this.formatting.getCodingIssueText(coding.codingIssueOption))
      );
      if (includeModalValue) {
        rowFields.push(
          this.formatting.escapeCsvField(modal?.modalValue ?? ''),
          this.formatting.escapeCsvField(modal?.deviationCount ?? ''),
          this.formatting.escapeCsvField(getModalTieLabel(modal)),
          this.formatting.escapeCsvField(formatModalCandidates(modal))
        );
      }
      if (includeDoubleCoded) rowFields.push(this.formatting.escapeCsvField(codes.length > 1 ? 'Ja' : 'Nein'));
      if (includeReplayUrl) rowFields.push(this.formatting.escapeCsvField(replayUrl));
      csv += `${rowFields.join(';')}\n`;
    });

    return { csv, rowCount: codingEntries.length };
  }
}
