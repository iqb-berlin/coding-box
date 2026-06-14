import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { VariableAnalysisItemDto } from '../../../../../../../api-dto/coding/variable-analysis-item.dto';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { CodingListService } from '../coding/coding-list.service';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';

interface CodingScheme {
  variableCodings?: {
    id: string;
    sourceType?: string;
    label?: string;
  }[];
  [key: string]: unknown;
}

interface UnitVariablePair {
  unitId: string;
  variableId: string;
}

interface VariableAnalysisAggregationRow {
  unitId: string;
  variableId: string;
  code_v1: string | null;
  occurrenceCount: string;
  score_V1: string;
}

interface VariableAnalysisSampleInfoRow {
  unitId: string;
  variableId: string;
  code_v1: string | null;
  loginName: string;
  loginCode: string;
  loginGroup: string;
  bookletId: string;
}

@Injectable()
export class VariableAnalysisReplayService {
  private readonly logger = new Logger(VariableAnalysisReplayService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private workspaceFilesService: WorkspaceFilesService,
    private codingListService: CodingListService,
    private workspaceExclusionService: WorkspaceExclusionService
  ) {}

  async getVariableAnalysis(
    workspace_id: number,
    authToken: string,
    serverUrl?: string,
    page: number = 1,
    limit: number = 100,
    unitIdFilter?: string,
    variableIdFilter?: string,
    derivationFilter?: string
  ): Promise<{
      data: VariableAnalysisItemDto[];
      total: number;
      page: number;
      limit: number;
    }> {
    try {
      this.logger.log(`Getting variable analysis for workspace ${workspace_id} (page ${page}, limit ${limit})`);
      const startTime = Date.now();
      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspace_id);

      this.logger.log('Getting unit variables mapping...');
      const unitVariablesMap = await this.workspaceFilesService.getUnitVariableMap(workspace_id);
      this.logger.log(`Retrieved unit variables map with ${unitVariablesMap.size} units`);

      // Step 2: Pre-fetch all coding schemes for the workspace to get derivations and descriptions for the response
      this.logger.log('Pre-fetching coding schemes for derivation info...');
      const codingSchemes = await this.fileUploadRepository.find({
        where: {
          workspace_id,
          file_type: 'Resource',
          file_id: Like('%.VOCS')
        }
      });

      const codingSchemeMap = new Map<string, CodingScheme>();
      for (const scheme of codingSchemes) {
        try {
          const unitId = scheme.file_id.replace('.VOCS', '');
          const parsedScheme = JSON.parse(scheme.data) as CodingScheme;
          codingSchemeMap.set(unitId, parsedScheme);
        } catch (error) {
          this.logger.error(`Error parsing coding scheme ${scheme.file_id}: ${error.message}`, error.stack);
        }
      }
      this.logger.log(`Pre-fetched ${codingSchemeMap.size} coding schemes in ${Date.now() - startTime}ms`);

      const validVariablePairKeys = this.getValidVariablePairKeys(
        unitVariablesMap,
        codingSchemeMap,
        derivationFilter
      );

      if (validVariablePairKeys.length === 0) {
        return {
          data: [],
          total: 0,
          page,
          limit
        };
      }

      const countQuery = this.responseRepository.createQueryBuilder('response')
        .select('COUNT(DISTINCT CONCAT(unit.name, CHR(31), response.variableid, CHR(31), response.code_v1))', 'count')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspace_id', { workspace_id });
      applyResolvedExclusionsToQuery(countQuery, exclusions);
      this.applyVariablePairFilter(countQuery, validVariablePairKeys, 'validVariablePairKeys');

      if (unitIdFilter) {
        countQuery.andWhere('unit.name LIKE :unitId', { unitId: `%${unitIdFilter}%` });
      }

      if (variableIdFilter) {
        countQuery.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableIdFilter}%` });
      }

      const totalCountResult = await countQuery.getRawOne();
      const totalCount = parseInt(totalCountResult?.count || '0', 10);
      this.logger.log(`Total unique combinations: ${totalCount}`);

      const aggregationQuery = this.responseRepository.createQueryBuilder('response')
        .select('unit.name', 'unitId')
        .addSelect('response.variableid', 'variableId')
        .addSelect('response.code_v1', 'code_v1')
        .addSelect('COUNT(response.id)', 'occurrenceCount')
        .addSelect('MAX(response.score_v1)', 'score_V1') // Use MAX as a sample score
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspace_id', { workspace_id });
      applyResolvedExclusionsToQuery(aggregationQuery, exclusions);
      this.applyVariablePairFilter(aggregationQuery, validVariablePairKeys, 'aggregationVariablePairKeys');

      if (unitIdFilter) {
        aggregationQuery.andWhere('unit.name LIKE :unitId', { unitId: `%${unitIdFilter}%` });
      }

      if (variableIdFilter) {
        aggregationQuery.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableIdFilter}%` });
      }

      aggregationQuery
        .groupBy('unit.name')
        .addGroupBy('response.variableid')
        .addGroupBy('response.code_v1')
        .orderBy('unit.name', 'ASC')
        .addOrderBy('response.variableid', 'ASC')
        .addOrderBy('response.code_v1', 'ASC')
        .offset((page - 1) * limit)
        .limit(limit);

      const aggregatedResults = await aggregationQuery.getRawMany<VariableAnalysisAggregationRow>();
      this.logger.log(`Retrieved ${aggregatedResults.length} aggregated combinations for page ${page}`);

      if (aggregatedResults.length === 0) {
        return {
          data: [],
          total: totalCount,
          page,
          limit
        };
      }
      const unitVariableCounts = new Map<string, Map<string, number>>();
      const unitVariableCombinations = this.getUniqueUnitVariablePairs(aggregatedResults);
      const pageVariablePairKeys = unitVariableCombinations.map(combo => this.toVariablePairKey(combo.unitId, combo.variableId));

      const totalCountsQuery = this.responseRepository.createQueryBuilder('response')
        .select('unit.name', 'unitId')
        .addSelect('response.variableid', 'variableId')
        .addSelect('COUNT(response.id)', 'totalCount')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspace_id', { workspace_id });
      applyResolvedExclusionsToQuery(totalCountsQuery, exclusions, { parameterPrefix: 'variableAnalysisTotals' });
      this.applyVariablePairFilter(totalCountsQuery, pageVariablePairKeys, 'totalCountVariablePairKeys');

      if (unitIdFilter) {
        totalCountsQuery.andWhere('unit.name LIKE :unitId', { unitId: `%${unitIdFilter}%` });
      }

      if (variableIdFilter) {
        totalCountsQuery.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableIdFilter}%` });
      }

      totalCountsQuery.groupBy('unit.name')
        .addGroupBy('response.variableid');

      const totalCountsResults = await totalCountsQuery.getRawMany();

      for (const result of totalCountsResults) {
        if (!unitVariableCounts.has(result.unitId)) {
          unitVariableCounts.set(result.unitId, new Map<string, number>());
        }
        unitVariableCounts.get(result.unitId)?.set(result.variableId, parseInt(result.totalCount, 10));
      }

      const sampleInfoQuery = this.responseRepository.createQueryBuilder('response')
        .select('unit.name', 'unitId')
        .addSelect('response.variableid', 'variableId')
        .addSelect('response.code_v1', 'code_v1')
        .addSelect('person.login', 'loginName')
        .addSelect('person.code', 'loginCode')
        .addSelect('person.group', 'loginGroup')
        .addSelect('bookletinfo.name', 'bookletId')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspace_id', { workspace_id });
      applyResolvedExclusionsToQuery(sampleInfoQuery, exclusions, { parameterPrefix: 'variableAnalysisSample' });
      this.applyVariablePairFilter(sampleInfoQuery, pageVariablePairKeys, 'sampleVariablePairKeys');

      sampleInfoQuery.groupBy('unit.name')
        .addGroupBy('response.variableid')
        .addGroupBy('response.code_v1')
        .addGroupBy('person.login')
        .addGroupBy('person.code')
        .addGroupBy('person.group')
        .addGroupBy('bookletinfo.name');

      const sampleInfoResults = await sampleInfoQuery.getRawMany<VariableAnalysisSampleInfoRow>();

      const sampleInfoMap = new Map<string, { loginName: string; loginCode: string; loginGroup: string; bookletId: string }>();
      for (const result of sampleInfoResults) {
        const key = this.toAggregationKey(result.unitId, result.variableId, result.code_v1);
        if (sampleInfoMap.has(key)) {
          continue;
        }

        sampleInfoMap.set(key, {
          loginName: result.loginName || '',
          loginCode: result.loginCode || '',
          loginGroup: result.loginGroup || '',
          bookletId: result.bookletId || ''
        });
      }

      const result: VariableAnalysisItemDto[] = [];

      // Pre-load variable page maps for all unique units
      const uniqueUnitIds = new Set(unitVariableCombinations.map(item => item.unitId));
      const variablePageMaps = new Map<string, Map<string, string>>();
      for (const unitId of uniqueUnitIds) {
        const pageMap = await this.codingListService.getVariablePageMap(unitId, workspace_id);
        variablePageMaps.set(unitId, pageMap);
      }

      for (const item of aggregatedResults) {
        const unitId = item.unitId;
        const variableId = item.variableId;
        const code = item.code_v1?.toString() ?? '';
        const occurrenceCount = parseInt(item.occurrenceCount, 10);
        const score = parseFloat(item.score_V1) || 0;

        const variableTotalCount = unitVariableCounts.get(unitId)?.get(variableId) || 0;

        const relativeOccurrence = variableTotalCount > 0 ? occurrenceCount / variableTotalCount : 0;

        const variableCoding = this.getVariableCoding(codingSchemeMap, unitId, variableId);
        const derivation = variableCoding?.sourceType || '';
        const description = variableCoding?.label || '';

        const sampleInfo = sampleInfoMap.get(this.toAggregationKey(unitId, variableId, code));
        const loginName = sampleInfo?.loginName || '';
        const loginCode = sampleInfo?.loginCode || '';
        const loginGroup = sampleInfo?.loginGroup || '';
        const bookletId = sampleInfo?.bookletId || '';

        // Get variable page from VOUD data
        const variablePage = variablePageMaps.get(unitId)?.get(variableId) || '0';
        const replayUrl = `${serverUrl}/#/replay/${loginName}@${loginCode}@${loginGroup}@${bookletId}/${unitId}/${variablePage}/${variableId}?auth=${authToken}`;

        result.push({
          replayUrl,
          unitId,
          variableId,
          derivation,
          code,
          description,
          score,
          occurrenceCount,
          totalCount: variableTotalCount,
          relativeOccurrence
        });
      }

      const endTime = Date.now();
      this.logger.log(`Variable analysis completed in ${endTime - startTime}ms`);

      return {
        data: result,
        total: totalCount,
        page,
        limit
      };
    } catch (error) {
      this.logger.error(`Error getting variable analysis: ${error.message}`, error.stack);
      throw new Error('Could not retrieve variable analysis data. Please check the database connection or query.');
    }
  }

  private getValidVariablePairKeys(
    unitVariablesMap: Map<string, Set<string>>,
    codingSchemeMap: Map<string, CodingScheme>,
    derivationFilter?: string
  ): string[] {
    const normalizedDerivationFilter = derivationFilter?.trim().toLowerCase();
    const validVariablePairKeys: string[] = [];

    for (const [unitId, variableIds] of unitVariablesMap.entries()) {
      for (const variableId of variableIds) {
        if (normalizedDerivationFilter) {
          const variableCoding = this.getVariableCoding(codingSchemeMap, unitId, variableId);
          const derivation = variableCoding?.sourceType || '';
          if (!derivation.toLowerCase().includes(normalizedDerivationFilter)) {
            continue;
          }
        }

        validVariablePairKeys.push(this.toVariablePairKey(unitId, variableId));
      }
    }

    return validVariablePairKeys;
  }

  private applyVariablePairFilter(
    queryBuilder: { andWhere: (condition: string, parameters?: Record<string, unknown>) => unknown },
    variablePairKeys: string[],
    parameterName: string
  ): void {
    if (variablePairKeys.length === 0) {
      queryBuilder.andWhere('1 = 0');
      return;
    }

    queryBuilder.andWhere(
      `CONCAT(unit.name, CHR(31), response.variableid) IN (:...${parameterName})`,
      { [parameterName]: variablePairKeys }
    );
  }

  private getUniqueUnitVariablePairs(rows: VariableAnalysisAggregationRow[]): UnitVariablePair[] {
    const pairs = new Map<string, UnitVariablePair>();

    for (const row of rows) {
      const key = this.toVariablePairKey(row.unitId, row.variableId);
      if (!pairs.has(key)) {
        pairs.set(key, {
          unitId: row.unitId,
          variableId: row.variableId
        });
      }
    }

    return Array.from(pairs.values());
  }

  private getVariableCoding(
    codingSchemeMap: Map<string, CodingScheme>,
    unitId: string,
    variableId: string
  ): { id: string; sourceType?: string; label?: string } | undefined {
    const codingScheme = codingSchemeMap.get(unitId);
    if (!codingScheme?.variableCodings || !Array.isArray(codingScheme.variableCodings)) {
      return undefined;
    }

    return codingScheme.variableCodings.find(vc => vc.id === variableId);
  }

  private toVariablePairKey(unitId: string, variableId: string): string {
    return `${unitId}\u001F${variableId}`;
  }

  private toAggregationKey(unitId: string, variableId: string, code: string | number | null | undefined): string {
    return `${this.toVariablePairKey(unitId, variableId)}\u001F${code ?? ''}`;
  }
}
