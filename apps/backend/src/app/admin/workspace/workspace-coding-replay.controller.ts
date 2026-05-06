import {
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Param,
  Query,
  Res,
  Req,
  UseGuards
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { parseStringPromise } from 'xml2js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { CodingReplayService } from '../../database/services/coding/coding-replay.service';
import { WorkspaceFilesService } from '../../database/services/workspace/workspace-files.service';
import { WorkspacePlayerService } from '../../database/services/workspace/workspace-player.service';
import { WorkspaceTestResultsService } from '../../database/services/test-results';
import FileUpload from '../../database/entities/file_upload.entity';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';

interface ReplayUnitResponsePayload {
  responses: {
    id: string;
    content: string;
  }[];
}

interface ReplayAssetsPayload {
  unitDef: FilesDto[];
  player: FilesDto[];
  vocs: FilesDto[];
}

interface ReplayPayload extends ReplayAssetsPayload {
  response: ReplayUnitResponsePayload;
}

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingReplayController {
  private readonly logger = new Logger(WorkspaceCodingReplayController.name);
  private readonly replayPayloadBrowserCacheSeconds: number;

  constructor(
    private codingReplayService: CodingReplayService,
    private workspacePlayerService: WorkspacePlayerService,
    private workspaceFilesService: WorkspaceFilesService,
    private workspaceTestResultsService: WorkspaceTestResultsService,
    private configService: ConfigService
  ) {
    const configuredTtl = Number(
      this.configService.get('REPLAY_PAYLOAD_BROWSER_CACHE_SECONDS')
    );
    this.replayPayloadBrowserCacheSeconds = Number.isFinite(configuredTtl) ?
      Math.max(0, Math.floor(configuredTtl)) :
      300;
  }

  @Get(':workspace_id/coding/responses/:responseId/replay-url')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'responseId',
    type: Number,
    description: 'ID of the response'
  })
  @ApiQuery({
    name: 'authToken',
    required: true,
    description: 'Authentication token for the replay URL',
    type: String
  })
  @ApiOkResponse({
    description: 'Replay URL generated successfully.',
    schema: {
      type: 'object',
      properties: {
        replayUrl: { type: 'string', description: 'The generated replay URL' }
      }
    }
  })
  async getReplayUrl(
    @WorkspaceId() workspace_id: number,
      @Param('responseId') responseId: number,
      @Query('authToken') authToken: string,
      @Req() req: Request
  ): Promise<{ replayUrl: string }> {
    // Use x-forwarded-proto header if present (set by reverse proxy) to ensure
    // HTTPS URLs are generated when the app is behind a proxy, preventing mixed content errors
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const serverUrl = `${protocol}://${req.get('host')}`;
    return this.codingReplayService.generateReplayUrlForResponse(
      workspace_id,
      responseId,
      serverUrl,
      authToken
    );
  }

  @Get(':workspace_id/replay-payload/:testPerson/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'testPerson',
    type: String,
    description: 'Replay test person connector'
  })
  @ApiParam({
    name: 'unitId',
    type: String,
    description: 'Unit alias/ID'
  })
  @ApiOkResponse({
    description: 'Replay payload retrieved successfully.'
  })
  async getReplayPayload(
    @WorkspaceId() workspaceId: number,
      @Param('testPerson') testPerson: string,
      @Param('unitId') unitId: string,
      @Res({ passthrough: true }) res: Response
  ): Promise<ReplayPayload> {
    this.setReplayCacheHeaders(res);
    const startedAt = performance.now();
    const timings: Record<string, number> = {};

    try {
      const [assets, responsePayload] = await Promise.all([
        this.getReplayAssetsData(workspaceId, unitId, timings),
        this.getReplayResponseData(workspaceId, testPerson, unitId, timings)
      ]);

      const totalMs = Number((performance.now() - startedAt).toFixed(2));
      this.logger.debug(
        `Replay payload timings ws=${workspaceId} unit=${unitId.toUpperCase()}: ${JSON.stringify({
          ...timings,
          totalMs
        })}`
      );

      return {
        ...assets,
        response: responsePayload.response
      };
    } catch (error) {
      const totalMs = Number((performance.now() - startedAt).toFixed(2));
      this.logger.warn(
        `Replay payload failed ws=${workspaceId} unit=${unitId} after ${totalMs}ms: ${error.message}`
      );
      throw new InternalServerErrorException(
        `Error retrieving replay payload: ${error.message}`
      );
    }
  }

  @Get(':workspace_id/replay-assets/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'unitId',
    type: String,
    description: 'Unit alias/ID'
  })
  @ApiOkResponse({
    description: 'Replay unit assets retrieved successfully.'
  })
  async getReplayAssets(
    @WorkspaceId() workspaceId: number,
      @Param('unitId') unitId: string,
      @Res({ passthrough: true }) res: Response
  ): Promise<ReplayAssetsPayload> {
    this.setReplayCacheHeaders(res);
    const startedAt = performance.now();
    const timings: Record<string, number> = {};

    try {
      const assets = await this.getReplayAssetsData(workspaceId, unitId, timings);
      const totalMs = Number((performance.now() - startedAt).toFixed(2));
      this.logger.debug(
        `Replay asset timings ws=${workspaceId} unit=${unitId.toUpperCase()}: ${JSON.stringify({
          ...timings,
          totalMs
        })}`
      );
      return assets;
    } catch (error) {
      const totalMs = Number((performance.now() - startedAt).toFixed(2));
      this.logger.warn(
        `Replay assets failed ws=${workspaceId} unit=${unitId} after ${totalMs}ms: ${error.message}`
      );
      throw new InternalServerErrorException(
        `Error retrieving replay assets: ${error.message}`
      );
    }
  }

  @Get(':workspace_id/replay-response/:testPerson/:unitId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'testPerson',
    type: String,
    description: 'Replay test person connector'
  })
  @ApiParam({
    name: 'unitId',
    type: String,
    description: 'Unit alias/ID'
  })
  @ApiOkResponse({
    description: 'Replay response retrieved successfully.'
  })
  async getReplayResponse(
    @WorkspaceId() workspaceId: number,
      @Param('testPerson') testPerson: string,
      @Param('unitId') unitId: string,
      @Res({ passthrough: true }) res: Response
  ): Promise<{ response: ReplayUnitResponsePayload }> {
    this.setReplayCacheHeaders(res);
    const startedAt = performance.now();
    const timings: Record<string, number> = {};

    try {
      const responsePayload = await this.getReplayResponseData(
        workspaceId,
        testPerson,
        unitId,
        timings
      );
      const totalMs = Number((performance.now() - startedAt).toFixed(2));
      this.logger.debug(
        `Replay response timings ws=${workspaceId} unit=${unitId}: ${JSON.stringify({
          ...timings,
          totalMs
        })}`
      );
      return responsePayload;
    } catch (error) {
      const totalMs = Number((performance.now() - startedAt).toFixed(2));
      this.logger.warn(
        `Replay response failed ws=${workspaceId} unit=${unitId} after ${totalMs}ms: ${error.message}`
      );
      throw new InternalServerErrorException(
        `Error retrieving replay response: ${error.message}`
      );
    }
  }

  private async getReplayAssetsData(
    workspaceId: number,
    unitId: string,
    timings: Record<string, number>
  ): Promise<ReplayAssetsPayload> {
    const normalizedUnitId = unitId.toUpperCase();
    const [unitDef, unit, vocs] = await Promise.all([
      this.timed(timings, 'findUnitDefMs', () => this.workspacePlayerService.findUnitDef(
        workspaceId,
        normalizedUnitId
      )),
      this.timed(timings, 'findUnitMs', () => this.workspacePlayerService.findUnit(
        workspaceId,
        normalizedUnitId
      )),
      this.timed(timings, 'getVocsMs', () => this.workspaceFilesService.getVocs(
        workspaceId,
        normalizedUnitId
      ))
    ]);

    if (!unitDef?.length) {
      throw new Error(`Unit definition not found for ${unitId}`);
    }
    if (!unit?.length) {
      throw new Error(`Unit file not found for ${unitId}`);
    }

    const playerName = await this.timed(
      timings,
      'extractPlayerIdMs',
      () => this.extractNormalizedPlayerIdFromUnit(unit[0])
    );

    const player = await this.timed(
      timings,
      'findPlayerMs',
      () => this.workspacePlayerService.findPlayer(workspaceId, playerName)
    );

    if (!player?.length) {
      throw new Error(`Player not found for ${playerName}`);
    }

    return {
      unitDef,
      player,
      vocs
    };
  }

  private async getReplayResponseData(
    workspaceId: number,
    testPerson: string,
    unitId: string,
    timings: Record<string, number>
  ): Promise<{ response: ReplayUnitResponsePayload }> {
    const response = await this.timed(
      timings,
      'findUnitResponseMs',
      () => this.workspaceTestResultsService.findUnitResponse(
        workspaceId,
        testPerson,
        unitId
      )
    );

    return { response };
  }

  private async timed<T>(
    timings: Record<string, number>,
    key: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const started = performance.now();
    const result = await fn();
    timings[key] = Number((performance.now() - started).toFixed(2));
    return result;
  }

  private setReplayCacheHeaders(res: Response): void {
    if (this.replayPayloadBrowserCacheSeconds > 0) {
      res.setHeader(
        'Cache-Control',
        `private, max-age=${this.replayPayloadBrowserCacheSeconds}`
      );
    } else {
      res.setHeader('Cache-Control', 'no-store');
    }
    res.setHeader('Vary', 'Authorization');
  }

  private async extractNormalizedPlayerIdFromUnit(
    unitFile: FileUpload
  ): Promise<string> {
    const parsed = await parseStringPromise(unitFile.data);
    const playerRef = parsed?.Unit?.DefinitionRef?.[0]?.$?.player;
    if (!playerRef || typeof playerRef !== 'string') {
      throw new Error('Invalid unit file: player definition missing');
    }
    return this.normalizePlayerId(playerRef);
  }

  private normalizePlayerId(name: string): string {
    const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(.\D{3,4})?$/;
    const matches = name.match(reg);
    if (!matches) {
      throw new Error(`Invalid player id format: ${name}`);
    }

    const module = matches[1] || '';
    const major = parseInt(matches[3], 10) || 0;
    const minor = typeof matches[4] === 'string' ? parseInt(matches[4].substring(1), 10) : 0;
    const patch = typeof matches[5] === 'string' ? parseInt(matches[5].substring(1), 10) : 0;
    return `${module}-${major}.${minor}.${patch}`.toUpperCase();
  }
}
