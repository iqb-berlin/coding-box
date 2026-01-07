import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import FileUpload from '../../database/entities/file_upload.entity';
import { ResponseEntity } from '../../database/entities/response.entity';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { WorkspaceFilesService } from '../../database/services/workspace-files.service';
import { CodingListService } from './coding-list.service';

@Injectable()
export class VariableAnalysisReplayService {
  private readonly logger = new Logger(VariableAnalysisReplayService.name);

  constructor(
    @InjectRepository(FileUpload)
    private fileUploadRepository: Repository<FileUpload>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    private workspaceFilesService: WorkspaceFilesService,
    private codingListService: CodingListService
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

      interface CodingScheme {
        variableCodings?: {
          id: string;
          sourceType?: string;
          label?: string;
        }[];
        [key: string]: unknown;
      }

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

      const countQuery = this.responseRepository.createQueryBuilder('response')
        .select('COUNT(DISTINCT CONCAT(unit.name, response.variableid, response.code_v1))', 'count')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspace_id', { workspace_id });

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

      const aggregatedResults = await aggregationQuery.getRawMany();
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
      const unitVariableCombinations = Array.from(
        new Set(aggregatedResults.map(item => `${item.unitId}|${item.variableId}`))
      ).map(combined => {
        const [unitId, variableId] = combined.split('|');
        return { unitId, variableId };
      });

      const totalCountsQuery = this.responseRepository.createQueryBuilder('response')
        .select('unit.name', 'unitId')
        .addSelect('response.variableid', 'variableId')
        .addSelect('COUNT(response.id)', 'totalCount')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspace_id', { workspace_id });

      if (unitIdFilter) {
        totalCountsQuery.andWhere('unit.name LIKE :unitId', { unitId: `%${unitIdFilter}%` });
      }

      if (variableIdFilter) {
        totalCountsQuery.andWhere('response.variableid LIKE :variableId', { variableId: `%${variableIdFilter}%` });
      }

      if (unitVariableCombinations.length > 0) {
        unitVariableCombinations.forEach((combo, index) => {
          totalCountsQuery.orWhere(
            `(unit.name = :unitId${index} AND response.variableid = :variableId${index})`,
            {
              [`unitId${index}`]: combo.unitId,
              [`variableId${index}`]: combo.variableId
            }
          );
        });
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
        .addSelect('person.login', 'loginName')
        .addSelect('person.code', 'loginCode')
        .addSelect('person.group', 'loginGroup')
        .addSelect('bookletinfo.name', 'bookletId')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspace_id', { workspace_id });

      if (unitVariableCombinations.length > 0) {
        unitVariableCombinations.forEach((combo, index) => {
          sampleInfoQuery.orWhere(
            `(unit.name = :unitId${index} AND response.variableid = :variableId${index})`,
            {
              [`unitId${index}`]: combo.unitId,
              [`variableId${index}`]: combo.variableId
            }
          );
        });
      }

      sampleInfoQuery.groupBy('unit.name')
        .addGroupBy('response.variableid')
        .addGroupBy('person.login')
        .addGroupBy('person.code')
        .addGroupBy('person.group')
        .addGroupBy('bookletinfo.name');

      const sampleInfoResults = await sampleInfoQuery.getRawMany();

      const sampleInfoMap = new Map<string, { loginName: string; loginCode: string; loginGroup: string; bookletId: string }>();
      for (const result of sampleInfoResults) {
        const key = `${result.unitId}|${result.variableId}`;
        sampleInfoMap.set(key, {
          loginName: result.loginName || '',
          loginCode: result.loginCode || '',
          loginGroup: result.loginGroup || '',
          bookletId: result.bookletId || ''
        });
      }

      const result: VariableAnalysisItemDto[] = [];

      // Pre-load variable page maps for all unique units
      const uniqueUnitIds = new Set(aggregatedResults.map(item => item.unitId));
      const variablePageMaps = new Map<string, Map<string, string>>();
      for (const unitId of uniqueUnitIds) {
        const pageMap = await this.codingListService.getVariablePageMap(unitId, workspace_id);
        variablePageMaps.set(unitId, pageMap);
      }

      for (const item of aggregatedResults) {
        const unitId = item.unitId;
        const variableId = item.variableId;
        const code = item.code_v1;
        const occurrenceCount = parseInt(item.occurrenceCount, 10);
        const score = parseFloat(item.score_V1) || 0;

        const variableTotalCount = unitVariableCounts.get(unitId)?.get(variableId) || 0;

        const relativeOccurrence = variableTotalCount > 0 ? occurrenceCount / variableTotalCount : 0;

        const unitVariables = unitVariablesMap.get(unitId);
        if (!unitVariables || !unitVariables.has(variableId)) {
          continue;
        }

        let derivation = '';
        let description = '';
        const codingScheme = codingSchemeMap.get(unitId);
        if (codingScheme && codingScheme.variableCodings && Array.isArray(codingScheme.variableCodings)) {
          const variableCoding = codingScheme.variableCodings.find(vc => vc.id === variableId);
          if (variableCoding) {
            derivation = variableCoding.sourceType || '';
            description = variableCoding.label || '';
          }
        }

        const sampleInfo = sampleInfoMap.get(`${unitId}|${variableId}`);
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

      if (derivationFilter && derivationFilter.trim() !== '') {
        const filteredResult = result.filter(item => item.derivation.toLowerCase().includes(derivationFilter.toLowerCase()));

        const filteredCount = filteredResult.length;
        this.logger.log(`Applied derivation filter: ${derivationFilter}, filtered from ${result.length} to ${filteredCount} items`);

        const endTime = Date.now();
        this.logger.log(`Variable analysis completed in ${endTime - startTime}ms`);

        return {
          data: filteredResult,
          total: filteredCount,
          page,
          limit
        };
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
}
