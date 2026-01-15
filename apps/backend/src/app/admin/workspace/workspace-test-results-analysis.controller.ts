import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiBadRequestResponse
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceTestResultsService } from '../../database/services/workspace-test-results.service';
import { FlatResponseFrequenciesRequest, FlatResponseFilterOptions } from './dto/workspace-test-results.interfaces';
import { CacheService } from '../../cache/cache.service';

@ApiTags('Admin Workspace Test Results')
@Controller('admin/workspace')
export class WorkspaceTestResultsAnalysisController {
  constructor(
    private workspaceTestResultsService: WorkspaceTestResultsService,
    private cacheService: CacheService
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async findFlatResponses(
    @Param('workspace_id') workspace_id: number,
                           @Query('page') page: number = 1,
                           @Query('limit') limit: number = 50,
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
                           @Query('hasValue') hasValue?: string,
                           @Query('audioLowThreshold') audioLowThreshold?: string,
                           @Query('shortProcessing') shortProcessing?: string,
                           @Query('shortProcessingThresholdMs') shortProcessingThresholdMs?: string,
                           @Query('longLoading') longLoading?: string,
                           @Query('longLoadingThresholdMs') longLoadingThresholdMs?: string,
                           @Query('processingDurations') processingDurations?: string,
      @Query('processingDurationThresholdMs')
                           processingDurationThresholdMs?: string,
                           @Query('processingDurationMin') processingDurationMin?: string,
                           @Query('processingDurationMax') processingDurationMax?: string,
                           @Query('unitProgress') unitProgress?: string,
                           @Query('sessionBrowsers') sessionBrowsers?: string,
                           @Query('sessionOs') sessionOs?: string,
                           @Query('sessionScreens') sessionScreens?: string,
                           @Query('sessionIds') sessionIds?: string
  ): Promise<{ data: unknown[]; total: number; page: number; limit: number }> {
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
        sessionIds
      });
    return {
      data,
      total,
      page,
      limit
    };
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
    @Param('workspace_id') workspace_id: number,
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
      @Query('audioLowThreshold') audioLowThreshold?: string,
      @Query('shortProcessing') shortProcessing?: string,
      @Query('shortProcessingThresholdMs') shortProcessingThresholdMs?: string,
      @Query('longLoading') longLoading?: string,
      @Query('longLoadingThresholdMs') longLoadingThresholdMs?: string,
      @Query('processingDurations') processingDurations?: string,
      @Query('processingDurationThresholdMs')
                           processingDurationThresholdMs?: string,
                           @Query('unitProgress') unitProgress?: string,
                           @Query('sessionBrowsers') sessionBrowsers?: string,
                           @Query('sessionOs') sessionOs?: string,
                           @Query('sessionScreens') sessionScreens?: string,
                           @Query('sessionIds') sessionIds?: string
  ): Promise<FlatResponseFilterOptions> {
    const isEmpty = (v?: string) => !String(v || '').trim();
    const thresholdRaw = String(processingDurationThresholdMs || '').trim();
    const thresholdParsed = Number(thresholdRaw || 60000);
    const threshold = Number.isFinite(thresholdParsed) ?
      thresholdParsed :
      60000;

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
