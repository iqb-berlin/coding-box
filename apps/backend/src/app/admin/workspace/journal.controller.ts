import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Res,
  UseGuards
} from '@nestjs/common';
import { Response } from 'express';
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
import { WorkspaceId } from './workspace.decorator';
import { JournalService } from '../../database/services/journal.service';
import { JournalEntry } from '../../database/entities/journal-entry.entity';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { PaginatedJournalEntriesDto } from './dto/paginated-journal-entries.dto';

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
    type: JournalEntry
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async createJournalEntry(
    @WorkspaceId() workspaceId: number,
      @Body() createJournalEntryDto: CreateJournalEntryDto
  ): Promise<JournalEntry> {
    // Get the user ID from the request (assuming it's available in the JWT token)
    // For now, we'll use a placeholder
    const userId = 'current-user'; // This should be replaced with actual user ID from JWT

    const entityId = parseInt(createJournalEntryDto.entity_id, 10);

    if (Number.isNaN(entityId)) {
      throw new Error(`Invalid entity_id: "${createJournalEntryDto.entity_id}" is not a valid number`);
    }

    return this.journalService.createEntry(
      userId,
      workspaceId,
      createJournalEntryDto.action_type,
      createJournalEntryDto.entity_type,
      entityId,
      createJournalEntryDto.details ? JSON.parse(createJournalEntryDto.details) : undefined
    );
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
    description: 'Filter by user ID',
    type: String
  })
  @ApiQuery({
    name: 'actionType',
    required: false,
    description: 'Filter by action type',
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
    type: Number
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getJournalEntries(
    @WorkspaceId() workspaceId: number,
      @Query('page') page?: number,
      @Query('limit') limit?: number,
      @Query('userId') userId?: string,
      @Query('actionType') actionType?: string,
      @Query('entityType') entityType?: string,
      @Query('entityId') entityId?: number,
      @Query('fromDate') fromDate?: string,
      @Query('toDate') toDate?: string
  ): Promise<{ data: JournalEntry[]; total: number }> {
    const filters: {
      workspaceId: number;
      userId?: string;
      actionType?: string;
      entityType?: string;
      entityId?: number;
      fromDate?: Date;
      toDate?: Date;
    } = {
      workspaceId
    };

    if (userId) {
      filters.userId = userId;
    }

    if (actionType) {
      filters.actionType = actionType;
    }

    if (entityType) {
      filters.entityType = entityType;
    }

    if (entityId) {
      filters.entityId = entityId;
    }

    if (fromDate) {
      filters.fromDate = new Date(fromDate);
    }

    if (toDate) {
      filters.toDate = new Date(toDate);
    }

    return this.journalService.search(filters, { page, limit });
  }

  @Get(':workspace_id/journal/entity/:entityType/:entityId')
  @ApiOperation({
    summary: 'Get journal entries for a specific entity',
    description: 'Retrieves paginated journal entries for a specific entity'
  })
  @ApiParam({ name: 'workspace_id', type: Number, description: 'ID of the workspace' })
  @ApiParam({ name: 'entityType', type: String, description: 'Type of entity' })
  @ApiParam({ name: 'entityId', type: Number, description: 'ID of the entity' })
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getJournalEntriesByEntity(
    @WorkspaceId() workspaceId: number,
      @Param('entityType') entityType: string,
      @Param('entityId') entityId: number,
      @Query('page') page?: number,
      @Query('limit') limit?: number
  ): Promise<{ data: JournalEntry[]; total: number }> {
    return this.journalService.search(
      {
        workspaceId,
        entityType,
        entityId
      },
      { page, limit }
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getJournalEntriesByUser(
    @WorkspaceId() workspaceId: number,
      @Param('userId') userId: string,
      @Query('page') page?: number,
      @Query('limit') limit?: number
  ): Promise<{ data: JournalEntry[]; total: number }> {
    return this.journalService.search(
      {
        workspaceId,
        userId
      },
      { page, limit }
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getJournalEntriesByAction(
    @WorkspaceId() workspaceId: number,
      @Param('actionType') actionType: string,
      @Query('page') page?: number,
      @Query('limit') limit?: number
  ): Promise<{ data: JournalEntry[]; total: number }> {
    return this.journalService.search(
      {
        workspaceId,
        actionType
      },
      { page, limit }
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async downloadJournalEntriesAsCsv(
    @WorkspaceId() workspaceId: number,
      @Res() response: Response
  ): Promise<void> {
    const csvData = await this.journalService.generateCsv(workspaceId);
    response.send(csvData);
  }
}
