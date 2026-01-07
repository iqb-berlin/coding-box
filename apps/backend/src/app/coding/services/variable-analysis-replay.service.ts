import { Injectable, Logger } from '@nestjs/common';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { WorkspaceFilesFacade } from '../../workspaces/services/workspace-files-facade.service';
import { CodingListService } from './coding-list.service';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';

@Injectable()
export class VariableAnalysisReplayService {
  private readonly logger = new Logger(VariableAnalysisReplayService.name);

  constructor(
    private workspacesFacadeService: WorkspacesFacadeService,
    private workspaceFilesFacade: WorkspaceFilesFacade,
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
      const unitVariablesMap = await this.workspaceFilesFacade.getUnitVariableMap(workspace_id);
      this.logger.log(`Retrieved unit variables map with ${unitVariablesMap.size} units`);

      // Step 2: Pre-fetch all coding schemes for the workspace to get derivations and descriptions for the response
      this.logger.log('Pre-fetching coding schemes for derivation info...');
      const codingSchemes = await this.workspacesFacadeService.findFilesByPattern(workspace_id, 'Resource', '%.VOCS');

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
          const unitId = (scheme.file_id as string).replace('.VOCS', '');
          const parsedScheme = JSON.parse(scheme.data as string) as CodingScheme;
          codingSchemeMap.set(unitId, parsedScheme);
        } catch (error) {
          this.logger.error(`Error parsing coding scheme ${scheme.file_id}: ${error.message}`, error.stack);
        }
      }
      this.logger.log(`Pre-fetched ${codingSchemeMap.size} coding schemes in ${Date.now() - startTime}ms`);

      const totalCount = await this.workspacesFacadeService.getVariableAnalysisCount(workspace_id, unitIdFilter, variableIdFilter);
      this.logger.log(`Total unique combinations: ${totalCount}`);

      const aggregatedResults = await this.workspacesFacadeService.getVariableAnalysisAggregated(
        workspace_id,
        page,
        limit,
        unitIdFilter,
        variableIdFilter
      );
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
        const [unitId, variableId] = (combined as string).split('|');
        return { unitId: unitId as string, variableId: variableId as string };
      });

      const totalCountsResults = await this.workspacesFacadeService.getVariableAnalysisTotalCounts(
        workspace_id,
        unitVariableCombinations,
        unitIdFilter,
        variableIdFilter
      );

      for (const totalCountResult of totalCountsResults) {
        if (!unitVariableCounts.has(totalCountResult.unitId as string)) {
          unitVariableCounts.set(totalCountResult.unitId as string, new Map<string, number>());
        }
        unitVariableCounts.get(totalCountResult.unitId as string)?.set(totalCountResult.variableId as string, parseInt(totalCountResult.totalCount as string, 10));
      }

      const sampleInfoResults = await this.workspacesFacadeService.getVariableAnalysisSampleInfo(
        workspace_id,
        unitVariableCombinations
      );

      const sampleInfoMap = new Map<string, { loginName: string; loginCode: string; loginGroup: string; bookletId: string }>();
      for (const sampleResult of sampleInfoResults) {
        const key = `${sampleResult.unitId}|${sampleResult.variableId}`;
        sampleInfoMap.set(key, {
          loginName: sampleResult.loginName as string || '',
          loginCode: sampleResult.loginCode as string || '',
          loginGroup: sampleResult.loginGroup as string || '',
          bookletId: sampleResult.bookletId as string || ''
        });
      }

      const result: VariableAnalysisItemDto[] = [];

      // Pre-load variable page maps for all unique units
      const uniqueUnitIds = new Set(aggregatedResults.map(item => item.unitId as string));
      const variablePageMaps = new Map<string, Map<string, string>>();
      for (const unitId of uniqueUnitIds) {
        const pageMap = await this.codingListService.getVariablePageMap(unitId, workspace_id);
        variablePageMaps.set(unitId, pageMap);
      }

      for (const item of aggregatedResults) {
        const unitId = item.unitId as string;
        const variableId = item.variableId as string;
        const code = item.code_v1 as number;
        const occurrenceCount = parseInt(item.occurrenceCount as string, 10);
        const score = parseFloat(item.score_V1 as string) || 0;

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
        const baseUrl = serverUrl || '';
        const replayUrl = `${baseUrl}/#/replay/${loginName}@${loginCode}@${loginGroup}@${bookletId}/${unitId}/${variablePage}/${variableId}?auth=${authToken}`;

        result.push({
          replayUrl,
          unitId,
          variableId,
          derivation,
          code: code as unknown as string, // VariableAnalysisItemDto expects string for code
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
