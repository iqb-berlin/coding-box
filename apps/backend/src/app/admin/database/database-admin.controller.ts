import {
  Controller,
  Get,
  Header,
  Res,
  UseGuards,
  InternalServerErrorException
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../admin.guard';
import { DatabaseExportService } from './database-export.service';

@Controller('admin/database')
@ApiTags('admin')
export class DatabaseAdminController {
  constructor(private readonly databaseExportService: DatabaseExportService) {}

  @Get('export/sqlite')
  @ApiOperation({
    summary: 'Export database to SQLite',
    description: 'Exports the PostgreSQL database to SQLite format with streaming support for large files'
  })
  @ApiResponse({
    status: 200,
    description: 'SQLite database file downloaded successfully',
    content: {
      'application/x-sqlite3': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  @Header('Content-Type', 'application/x-sqlite3')
  @Header('Content-Disposition', 'attachment; filename=database-export.sqlite')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  async exportDatabaseToSqlite(@Res() response: Response): Promise<void> {
    try {
      await this.databaseExportService.exportToSqliteStream(response);
    } catch (error) {
      throw new InternalServerErrorException('Failed to export database to SQLite');
    }
  }
}
