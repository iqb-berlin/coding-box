import {
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Param,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { Request } from 'express';
import { parseStringPromise } from 'xml2js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { CodingReplayService } from '../../database/services/coding';
import {
  WorkspaceFilesService,
  WorkspacePlayerService
} from '../../database/services/workspace';
import { WorkspaceTestResultsService } from '../../database/services/test-results';
import FileUpload from '../../database/entities/file_upload.entity';
import { FilesDto } from '../../../../../../api-dto/files/files.dto';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingReplayController {
  private readonly logger = new Logger(WorkspaceCodingReplayController.name);

  constructor(
    private codingReplayService: CodingReplayService,
    private workspacePlayerService: WorkspacePlayerService,
    private workspaceFilesService: WorkspaceFilesService,
    private workspaceTestResultsService: WorkspaceTestResultsService
  ) { }

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
      @Param('unitId') unitId: string
  ): Promise<{
        unitDef: FilesDto[];
        response: {
          responses: {
            id: string;
            content: string;
          }[];
        };
        player: FilesDto[];
        vocs: FilesDto[];
      }> {
    const startedAt = performance.now();
    const timings: Record<string, number> = {};
    const timed = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
      const started = performance.now();
      const result = await fn();
      timings[key] = Number((performance.now() - started).toFixed(2));
      return result;
    };

    try {
      const normalizedUnitId = unitId.toUpperCase();
      const [unitDef, unit, response, vocs] = await Promise.all([
        timed('findUnitDefMs', () => this.workspacePlayerService.findUnitDef(
          workspaceId,
          normalizedUnitId
        )),
        timed('findUnitMs', () => this.workspacePlayerService.findUnit(
          workspaceId,
          normalizedUnitId
        )),
        timed('findUnitResponseMs', () => this.workspaceTestResultsService.findUnitResponse(
          workspaceId,
          testPerson,
          unitId
        )),
        timed('getVocsMs', () => this.workspaceFilesService.getVocs(
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

      const playerName = await timed(
        'extractPlayerIdMs',
        () => this.extractNormalizedPlayerIdFromUnit(unit[0])
      );

      const player = await timed(
        'findPlayerMs',
        () => this.workspacePlayerService.findPlayer(workspaceId, playerName)
      );

      if (!player?.length) {
        throw new Error(`Player not found for ${playerName}`);
      }

      const totalMs = Number((performance.now() - startedAt).toFixed(2));
      this.logger.debug(
        `Replay payload timings ws=${workspaceId} unit=${normalizedUnitId}: ${JSON.stringify({
          ...timings,
          totalMs
        })}`
      );

      return {
        unitDef,
        response,
        player,
        vocs
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
