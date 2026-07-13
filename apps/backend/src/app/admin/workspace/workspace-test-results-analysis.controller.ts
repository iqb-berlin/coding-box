import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  ParseIntPipe,
  ParseFloatPipe,
  DefaultValuePipe
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBadRequestResponse
} from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceTestResultsService } from '../../database/services/test-results';
import { FlatResponseFrequenciesRequest, FlatResponseFilterOptions } from './dto/workspace-test-results.interfaces';
import { CacheService } from '../../cache/cache.service';
import { Setting } from '../../database/entities/setting.entity';
import { getWorkspaceRegexSearchEnabled } from '../../utils/regex-search.util';

@ApiTags('Admin Workspace Test Results')
@Controller('admin/workspace')
export class WorkspaceTestResultsAnalysisController {
  constructor(
    private workspaceTestResultsService: WorkspaceTestResultsService,
    private cacheService: CacheService,
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>
  ) { }

  @Get(':workspace_id/test-results/flat-responses')
  @ApiOperation({
    summary: 'Get flat test result responses',
    description:
      'Retrieves paginated flat response rows for a workspace with optional filters'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Flat responses retrieved successfully.'
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve flat responses' })
  @ApiQuery({
    name: 'regexSearch',
    required: false,
    description:
      'Interpret selected text filters as case-sensitive regular expressions. ' +
      'Requires both regexSearch=true and the workspace setting to be enabled.',
    type: Boolean
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async findFlatResponses(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
                                         @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
                                         @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number = 50,
                                         @Query('code') code?: string,
                                         @Query('group') group?: string,
                                         @Query('login') login?: string,
                                         @Query('booklet') booklet?: string,
                                         @Query('unit') unit?: string,
                                         @Query('response') response?: string,
                                         @Query('regexSearch') regexSearch?: string,
                                         @Query('responseStatus') responseStatus?: string,
                                         @Query('responseValue') responseValue?: string,
                                         @Query('tags') tags?: string,
                                         @Query('geogebra') geogebra?: string,
                                         @Query('audioLow') audioLow?: string,
                                         @Query('hasValue') hasValue?: string,
                                         @Query('audioLowThreshold', new DefaultValuePipe(0.9), ParseFloatPipe) audioLowThreshold?: number,
                                         @Query('shortProcessing') shortProcessing?: string,
                                         @Query('shortProcessingThresholdMs', new DefaultValuePipe(60000), ParseIntPipe) shortProcessingThresholdMs?: number,
                                         @Query('longLoading') longLoading?: string,
                                         @Query('longLoadingThresholdMs', new DefaultValuePipe(5000), ParseIntPipe) longLoadingThresholdMs?: number,
                                         @Query('processingDurations') processingDurations?: string,
      @Query('processingDurationThresholdMs', new DefaultValuePipe(60000), ParseIntPipe)
                                         processingDurationThresholdMs?: number,
                                         @Query('processingDurationMin') processingDurationMin?: string,
                                         @Query('processingDurationMax') processingDurationMax?: string,
                                         @Query('unitProgress') unitProgress?: string,
                                         @Query('sessionBrowsers') sessionBrowsers?: string,
                                         @Query('sessionOs') sessionOs?: string,
                                         @Query('sessionScreens') sessionScreens?: string,
                                         @Query('sessionIds') sessionIds?: string,
                                         @Query('logAnomalies') logAnomalies?: string,
                                         @Query('includeLogAnomalies') includeLogAnomalies?: string,
                                         @Query('focusLostThresholdMs', new DefaultValuePipe(300000), ParseIntPipe) focusLostThresholdMs?: number,
                                         @Query('sessionSpanThresholdMs', new DefaultValuePipe(86400000), ParseIntPipe) sessionSpanThresholdMs?: number,
                                         @Query('repeatedStartThreshold', new DefaultValuePipe(2), ParseIntPipe) repeatedStartThreshold?: number
  ): Promise<{ data: unknown[]; total: number; page: number; limit: number }> {
    const effectiveRegexSearch = regexSearch === 'true' &&
      await getWorkspaceRegexSearchEnabled(this.settingRepository, workspace_id);
    const [data, total] =
      await this.workspaceTestResultsService.findFlatResponses(workspace_id, {
        page,
        limit,
        code,
        group,
        login,
        booklet,
        unit,
        response,
        regexSearch: effectiveRegexSearch,
        responseStatus,
        responseValue,
        tags,
        geogebra,
        audioLow,
        hasValue,
        audioLowThreshold,
        shortProcessing,
        shortProcessingThresholdMs,
        longLoading,
        longLoadingThresholdMs,
        processingDurations,
        processingDurationThresholdMs,
        processingDurationMin,
        processingDurationMax,
        unitProgress,
        sessionBrowsers,
        sessionOs,
        sessionScreens,
        sessionIds,
        logAnomalies,
        includeLogAnomalies,
        focusLostThresholdMs,
        sessionSpanThresholdMs,
        repeatedStartThreshold
      });
    return {
      data,
      total,
      page,
      limit
    };
  }

  @Get(':workspace_id/test-results/log-anomaly-summary')
  @ApiOperation({
    summary: 'Get compact log anomaly summary for a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Log anomaly summary retrieved successfully.'
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve log anomaly summary' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getLogAnomalySummary(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Query('longLoadingThresholdMs', new DefaultValuePipe(5000), ParseIntPipe) longLoadingThresholdMs?: number,
      @Query('focusLostThresholdMs', new DefaultValuePipe(300000), ParseIntPipe) focusLostThresholdMs?: number,
      @Query('sessionSpanThresholdMs', new DefaultValuePipe(86400000), ParseIntPipe) sessionSpanThresholdMs?: number,
      @Query('repeatedStartThreshold', new DefaultValuePipe(2), ParseIntPipe) repeatedStartThreshold?: number
  ): Promise<unknown> {
    return this.workspaceTestResultsService.getLogAnomalySummary(workspace_id, {
      longLoadingThresholdMs,
      focusLostThresholdMs,
      sessionSpanThresholdMs,
      repeatedStartThreshold
    });
  }

  @Get(':workspace_id/test-results/log-anomaly-details')
  @ApiOperation({
    summary: 'Get log anomaly details for affected booklets'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Log anomaly details retrieved successfully.'
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve log anomaly details' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getLogAnomalyDetails(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Query('longLoadingThresholdMs', new DefaultValuePipe(5000), ParseIntPipe) longLoadingThresholdMs?: number,
      @Query('focusLostThresholdMs', new DefaultValuePipe(300000), ParseIntPipe) focusLostThresholdMs?: number,
      @Query('sessionSpanThresholdMs', new DefaultValuePipe(86400000), ParseIntPipe) sessionSpanThresholdMs?: number,
      @Query('repeatedStartThreshold', new DefaultValuePipe(2), ParseIntPipe) repeatedStartThreshold?: number,
      @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit?: number
  ): Promise<unknown> {
    return this.workspaceTestResultsService.getLogAnomalyDetails(workspace_id, {
      longLoadingThresholdMs,
      focusLostThresholdMs,
      sessionSpanThresholdMs,
      repeatedStartThreshold,
      limit
    });
  }

  @Post(':workspace_id/test-results/flat-responses/frequencies')
  @ApiOperation({
    summary: 'Get response value frequencies for flat response combos'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Frequencies retrieved successfully.'
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve frequencies' })
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async findFlatResponseFrequencies(
    @Param('workspace_id') workspaceId: number,
      @Body() body: FlatResponseFrequenciesRequest
  ): Promise<Record<string, { total: number; values: Array<{ value: string; count: number; p: number }> }>> {
    try {
      return await this.workspaceTestResultsService.findFlatResponseFrequencies(
        workspaceId,
        body?.combos || []
      );
    } catch (error) {
      throw new BadRequestException(
        `Failed to retrieve frequencies. ${error.message}`
      );
    }
  }

  @Get(':workspace_id/test-results/flat-responses/filter-options')
  @ApiOperation({
    summary: 'Get flat response filter options'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async findFlatResponseFilterOptions(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Query('code') code?: string,
      @Query('group') group?: string,
      @Query('login') login?: string,
      @Query('booklet') booklet?: string,
      @Query('unit') unit?: string,
      @Query('response') response?: string,
      @Query('responseStatus') responseStatus?: string,
      @Query('responseValue') responseValue?: string,
      @Query('tags') tags?: string,
      @Query('geogebra') geogebra?: string,
      @Query('audioLow') audioLow?: string,
      @Query('audioLowThreshold', new DefaultValuePipe(0.9), ParseFloatPipe) audioLowThreshold?: number,
      @Query('shortProcessing') shortProcessing?: string,
      @Query('shortProcessingThresholdMs', new DefaultValuePipe(60000), ParseIntPipe) shortProcessingThresholdMs?: number,
      @Query('longLoading') longLoading?: string,
      @Query('longLoadingThresholdMs', new DefaultValuePipe(5000), ParseIntPipe) longLoadingThresholdMs?: number,
      @Query('processingDurations') processingDurations?: string,
      @Query('processingDurationThresholdMs', new DefaultValuePipe(60000), ParseIntPipe)
                                         processingDurationThresholdMs?: number,
                                         @Query('unitProgress') unitProgress?: string,
                                         @Query('sessionBrowsers') sessionBrowsers?: string,
                                         @Query('sessionOs') sessionOs?: string,
                                         @Query('sessionScreens') sessionScreens?: string,
                                         @Query('sessionIds') sessionIds?: string
  ): Promise<FlatResponseFilterOptions> {
    const isEmpty = (v?: string | number) => !String(v || '').trim();
    const threshold = Number(processingDurationThresholdMs || 60000);

    const audioLowEnabled = !isEmpty(audioLow);
    const shortProcessingEnabled = !isEmpty(shortProcessing);
    const longLoadingEnabled = !isEmpty(longLoading);

    const isNoFilterRequest =
      isEmpty(code) &&
      isEmpty(group) &&
      isEmpty(login) &&
      isEmpty(booklet) &&
      isEmpty(unit) &&
      isEmpty(response) &&
      isEmpty(responseStatus) &&
      isEmpty(responseValue) &&
      isEmpty(tags) &&
      isEmpty(geogebra) &&
      isEmpty(audioLow) &&
      (!audioLowEnabled || isEmpty(audioLowThreshold)) &&
      isEmpty(shortProcessing) &&
      (!shortProcessingEnabled || isEmpty(shortProcessingThresholdMs)) &&
      isEmpty(longLoading) &&
      (!longLoadingEnabled || isEmpty(longLoadingThresholdMs)) &&
      isEmpty(processingDurations) &&
      isEmpty(unitProgress) &&
      isEmpty(sessionBrowsers) &&
      isEmpty(sessionOs) &&
      isEmpty(sessionScreens) &&
      isEmpty(sessionIds);

    if (isNoFilterRequest) {
      const versionKey =
        this.cacheService.generateFlatResponseFilterOptionsVersionKey(
          workspace_id
        );
      const version = await this.cacheService.getNumber(versionKey, 1);
      const cacheKey =
        this.cacheService.generateFlatResponseFilterOptionsCacheKey(
          workspace_id,
          version,
          threshold
        );
      const cached = await this.cacheService.get<FlatResponseFilterOptions>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const result =
      await this.workspaceTestResultsService.findFlatResponseFilterOptions(
        workspace_id,
        {
          code,
          group,
          login,
          booklet,
          unit,
          response,
          responseStatus,
          responseValue,
          tags,
          geogebra,
          audioLow,
          audioLowThreshold,
          shortProcessing,
          shortProcessingThresholdMs,
          longLoading,
          longLoadingThresholdMs,
          processingDurations,
          processingDurationThresholdMs,
          unitProgress,
          sessionBrowsers,
          sessionOs,
          sessionScreens,
          sessionIds
        }
      );

    if (isNoFilterRequest) {
      const versionKey =
        this.cacheService.generateFlatResponseFilterOptionsVersionKey(
          workspace_id
        );
      const version = await this.cacheService.getNumber(versionKey, 1);
      const cacheKey =
        this.cacheService.generateFlatResponseFilterOptionsCacheKey(
          workspace_id,
          version,
          threshold
        );
      await this.cacheService.set(cacheKey, result, 0);
    }

    return result;
  }
}
