import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceId } from './workspace.decorator';
import { JournalService } from '../../database/services/shared';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { PaginatedJournalEntriesDto } from './dto/paginated-journal-entries.dto';
import { AuditJournalEntryResponseDto } from './dto/audit-journal-entry-response.dto';
import {
  AuditActorType,
  AuditEventResult,
  AuditJournalEntryDto,
  PaginatedAuditJournalEntriesDto,
  auditActorTypes,
  auditEventResults
} from '../../../../../../api-dto/audit-journal/audit-journal.dto';

interface RequestWithUser extends Request {
  user: {
    id: string | number;
  };
}

@ApiTags('Admin Workspace Journal')
@Controller('admin/workspace')
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  @Post(':workspace_id/journal')
  @ApiOperation({
    summary: 'Create a journal entry',
    description: 'Creates a new journal entry for tracking actions in the workspace'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiBody({ type: CreateJournalEntryDto })
  @ApiResponse({
    status: 201,
    description: 'Journal entry created successfully',
    type: AuditJournalEntryResponseDto
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async createJournalEntry(
    @WorkspaceId() workspaceId: number,
      @Body() createJournalEntryDto: CreateJournalEntryDto,
      @Req() request: RequestWithUser
  ): Promise<AuditJournalEntryDto> {
    const details = this.parseDetails(createJournalEntryDto.details);
    const entityType = createJournalEntryDto.entityType || createJournalEntryDto.entity_type;
    const eventType = createJournalEntryDto.eventType?.trim() ||
      this.journalService.mapLegacyEventType(createJournalEntryDto.action_type, entityType);
    const actorType = createJournalEntryDto.actorType ?
      this.parseActorType(createJournalEntryDto.actorType) :
      'user';
    const result = createJournalEntryDto.result ?
      this.parseResult(createJournalEntryDto.result) :
      'success';

    const entry = await this.journalService.recordEvent({
      workspaceId,
      actorUserId: request.user?.id,
      actorType,
      eventType,
      legacyActionType: createJournalEntryDto.action_type,
      entityType,
      entityId: createJournalEntryDto.entityId ?? createJournalEntryDto.entity_id ?? null,
      result,
      summary: createJournalEntryDto.summary,
      details,
      correlationId: createJournalEntryDto.correlationId,
      jobId: createJournalEntryDto.jobId
    });

    return this.journalService.toAuditDto(entry);
  }

  @Get(':workspace_id/journal')
  @ApiOperation({
    summary: 'Get journal entries for a workspace',
    description: 'Retrieves paginated journal entries for a workspace'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    type: Number
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    description: 'Filter by numeric or opaque actor user ID',
    type: String
  })
  @ApiQuery({
    name: 'actorUserId',
    required: false,
    description: 'Filter by numeric actor user ID',
    type: Number
  })
  @ApiQuery({
    name: 'actorType',
    required: false,
    description: 'Filter by actor type',
    enum: auditActorTypes
  })
  @ApiQuery({
    name: 'eventType',
    required: false,
    description: 'Filter by audit event type',
    type: String
  })
  @ApiQuery({
    name: 'actionType',
    required: false,
    description: 'Deprecated legacy action_type filter',
    type: String
  })
  @ApiQuery({
    name: 'entityType',
    required: false,
    description: 'Filter by entity type',
    type: String
  })
  @ApiQuery({
    name: 'entityId',
    required: false,
    description: 'Filter by entity ID',
    type: String
  })
  @ApiQuery({
    name: 'result',
    required: false,
    description: 'Filter by audit event result',
    enum: auditEventResults
  })
  @ApiQuery({
    name: 'fromDate',
    required: false,
    description: 'Filter by start date (ISO format)',
    type: String
  })
  @ApiQuery({
    name: 'toDate',
    required: false,
    description: 'Filter by end date (ISO format)',
    type: String
  })
  @ApiResponse({
    status: 200,
    description: 'Journal entries retrieved successfully',
    type: PaginatedJournalEntriesDto
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getJournalEntries(
    @WorkspaceId() workspaceId: number,
      @Query('page') page?: string,
      @Query('limit') limit?: string,
      @Query('userId') userId?: string,
      @Query('actorUserId') actorUserId?: string,
      @Query('actorType') actorType?: string,
      @Query('eventType') eventType?: string,
      @Query('actionType') actionType?: string,
      @Query('entityType') entityType?: string,
      @Query('entityId') entityId?: string,
      @Query('result') result?: string,
      @Query('fromDate') fromDate?: string,
      @Query('toDate') toDate?: string
  ): Promise<PaginatedAuditJournalEntriesDto> {
    const filters: {
      workspaceId: number;
      actorUserId?: number;
      legacyUserId?: string;
      actorType?: AuditActorType;
      eventType?: string;
      actionType?: string;
      entityType?: string;
      entityId?: string;
      result?: AuditEventResult;
      fromDate?: Date;
      toDate?: Date;
    } = {
      workspaceId
    };

    const parsedActorUserId = actorUserId ?
      this.parseOptionalPositiveInteger(actorUserId, 'actorUserId') :
      undefined;
    if (parsedActorUserId !== undefined) {
      filters.actorUserId = parsedActorUserId;
    } else if (userId) {
      this.applyUserIdFilter(filters, userId);
    }

    if (actorType) {
      filters.actorType = this.parseActorType(actorType);
    }

    if (eventType) {
      filters.eventType = eventType;
    }

    if (actionType) {
      filters.actionType = actionType;
    }

    if (entityType) {
      filters.entityType = entityType;
    }

    if (entityId !== undefined && entityId !== '') {
      filters.entityId = entityId;
    }

    if (result) {
      filters.result = this.parseResult(result);
    }

    if (fromDate) {
      filters.fromDate = this.parseDate(fromDate, 'fromDate');
    }

    if (toDate) {
      filters.toDate = this.parseDate(toDate, 'toDate');
    }

    return this.journalService.search(filters, {
      page: this.parseOptionalPositiveInteger(page, 'page'),
      limit: this.parseOptionalPositiveInteger(limit, 'limit')
    });
  }

  @Get(':workspace_id/journal/entity/:entityType/:entityId')
  @ApiOperation({
    summary: 'Get journal entries for a specific entity',
    description: 'Retrieves paginated journal entries for a specific entity'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiParam({ name: 'entityType', type: String, description: 'Type of entity' })
  @ApiParam({ name: 'entityId', type: String, description: 'ID of the entity' })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    type: Number
  })
  @ApiResponse({
    status: 200,
    description: 'Journal entries retrieved successfully',
    type: PaginatedJournalEntriesDto
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getJournalEntriesByEntity(
    @WorkspaceId() workspaceId: number,
      @Param('entityType') entityType: string,
      @Param('entityId') entityId: string,
      @Query('page') page?: string,
      @Query('limit') limit?: string
  ): Promise<PaginatedAuditJournalEntriesDto> {
    return this.journalService.search(
      {
        workspaceId,
        entityType,
        entityId
      },
      {
        page: this.parseOptionalPositiveInteger(page, 'page'),
        limit: this.parseOptionalPositiveInteger(limit, 'limit')
      }
    );
  }

  @Get(':workspace_id/journal/user/:userId')
  @ApiOperation({
    summary: 'Get journal entries for a specific user',
    description: 'Retrieves paginated journal entries for a specific user'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiParam({ name: 'userId', type: String, description: 'ID of the user' })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    type: Number
  })
  @ApiResponse({
    status: 200,
    description: 'Journal entries retrieved successfully',
    type: PaginatedJournalEntriesDto
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getJournalEntriesByUser(
    @WorkspaceId() workspaceId: number,
      @Param('userId') userId: string,
      @Query('page') page?: string,
      @Query('limit') limit?: string
  ): Promise<PaginatedAuditJournalEntriesDto> {
    const userFilters: { actorUserId?: number; legacyUserId?: string } = {};
    this.applyUserIdFilter(userFilters, userId);
    return this.journalService.search(
      {
        workspaceId,
        ...userFilters
      },
      {
        page: this.parseOptionalPositiveInteger(page, 'page'),
        limit: this.parseOptionalPositiveInteger(limit, 'limit')
      }
    );
  }

  @Get(':workspace_id/journal/action/:actionType')
  @ApiOperation({
    summary: 'Get journal entries for a specific action type',
    description: 'Retrieves paginated journal entries for a specific action type'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiParam({ name: 'actionType', type: String, description: 'Type of action' })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    type: Number
  })
  @ApiResponse({
    status: 200,
    description: 'Journal entries retrieved successfully',
    type: PaginatedJournalEntriesDto
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async getJournalEntriesByAction(
    @WorkspaceId() workspaceId: number,
      @Param('actionType') actionType: string,
      @Query('page') page?: string,
      @Query('limit') limit?: string
  ): Promise<PaginatedAuditJournalEntriesDto> {
    return this.journalService.search(
      {
        workspaceId,
        actionType
      },
      {
        page: this.parseOptionalPositiveInteger(page, 'page'),
        limit: this.parseOptionalPositiveInteger(limit, 'limit')
      }
    );
  }

  @Get(':workspace_id/journal/csv')
  @ApiOperation({
    summary: 'Download journal entries as CSV',
    description: 'Downloads all journal entries for a workspace as a CSV file'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiResponse({
    status: 200,
    description: 'CSV file generated successfully',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename=journal-entries.csv')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async downloadJournalEntriesAsCsv(
    @WorkspaceId() workspaceId: number,
      @Res() response: Response
  ): Promise<void> {
    const csvData = await this.journalService.generateCsv(workspaceId);
    response.send(csvData);
  }

  private parseOptionalPositiveInteger(value: string | undefined, name: string): number | undefined {
    if (value === undefined || value === '') {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${name} must be a positive integer`);
    }
    return parsed;
  }

  private applyUserIdFilter(
    filters: { actorUserId?: number; legacyUserId?: string },
    value: string
  ): void {
    const parsed = this.tryParsePositiveInteger(value);
    if (parsed !== undefined) {
      filters.actorUserId = parsed;
      return;
    }
    filters.legacyUserId = value;
  }

  private tryParsePositiveInteger(value: string): number | undefined {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  private parseDate(value: string, name: string): Date {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ?
      this.parseDateOnly(value, name) :
      new Date(value);
    this.assertValidIsoDatePart(value, name);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${name} must be a valid date`);
    }
    return parsed;
  }

  private parseDateOnly(value: string, name: string): Date {
    const [year, month, day] = value.split('-').map(part => Number(part));
    const parsed = name === 'toDate' ?
      new Date(year, month - 1, day, 23, 59, 59, 999) :
      new Date(year, month - 1, day, 0, 0, 0, 0);

    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      throw new BadRequestException(`${name} must be a valid date`);
    }

    return parsed;
  }

  private assertValidIsoDatePart(value: string, name: string): void {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)$/);
    if (!match) {
      return;
    }

    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const parsedDatePart = new Date(year, month - 1, day);
    if (
      parsedDatePart.getFullYear() !== year ||
      parsedDatePart.getMonth() !== month - 1 ||
      parsedDatePart.getDate() !== day
    ) {
      throw new BadRequestException(`${name} must be a valid date`);
    }
  }

  private parseActorType(value: string): AuditActorType {
    if (!auditActorTypes.includes(value as AuditActorType)) {
      throw new BadRequestException(`actorType must be one of: ${auditActorTypes.join(', ')}`);
    }
    return value as AuditActorType;
  }

  private parseResult(value: string): AuditEventResult {
    if (!auditEventResults.includes(value as AuditEventResult)) {
      throw new BadRequestException(`result must be one of: ${auditEventResults.join(', ')}`);
    }
    return value as AuditEventResult;
  }

  private parseDetails(details?: string | Record<string, unknown> | null): Record<string, unknown> | null {
    if (!details) {
      return null;
    }
    if (Array.isArray(details)) {
      throw new BadRequestException('details must be a JSON object');
    }
    if (typeof details === 'object') {
      return details;
    }
    try {
      const parsed = JSON.parse(details);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('details must be a JSON object');
      }
      return parsed;
    } catch (error) {
      throw new BadRequestException(`details must be a valid JSON object: ${error.message}`);
    }
  }
}
