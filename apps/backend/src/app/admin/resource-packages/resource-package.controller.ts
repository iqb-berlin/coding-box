import {
  Controller,
  Delete,
  Get, Header, NotFoundException,
  Param,
  ParseArrayPipe,
  ParseIntPipe,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards
} from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBearerAuth, ApiCreatedResponse, ApiNotFoundResponse,
  ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags
} from '@nestjs/swagger';
import { Express } from 'express';
import 'multer';
import { ResourcePackageService } from '../../database/services/workspace';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from '../workspace/access-level.guard';
import { ApiFile } from './api-file.decorator';
import { fileMimetypeFilter } from './file-mimetype-filter';
import { ParseFile } from './parse-file-pipe';
import { ResourcePackageDto } from '../../../../../../api-dto/resource-package/resource-package-dto';

@ApiTags('Admin Resource Packages')
@Controller('admin/workspace/:workspace_id/resource-packages')
export class ResourcePackageController {
  constructor(
    private resourcePackageService: ResourcePackageService
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get all resource packages for a workspace',
    description: 'Retrieves a list of all resource packages for the specified workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'The ID of the workspace',
    required: true
  })
  @ApiOkResponse({
    description: 'Resource Packages retrieved successfully.',
    type: [ResourcePackageDto]
  })
  @ApiNotFoundResponse({
    description: 'No resource packages found.'
  })
  @ApiBadRequestResponse({ description: 'Failed to retrieve resource packages' })
  async findResourcePackages(
    @Param('workspace_id', ParseIntPipe) workspaceId: number
  ): Promise<ResourcePackageDto[]> {
    const resourcePackages = await this.resourcePackageService.findResourcePackages(workspaceId);

    if (!resourcePackages || resourcePackages.length === 0) {
      throw new NotFoundException(`No resource packages found for workspace ${workspaceId}.`);
    }

    return resourcePackages;
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'The ID of the workspace',
    required: true
  })
  @ApiParam({
    name: 'id',
    type: Number,
    description: 'The ID of the resource package',
    required: true
  })
  @ApiOkResponse({ description: 'Resource Package deleted successfully.' })
  @ApiNotFoundResponse({ description: 'Resource package not found.' })
  @ApiTags('admin resource-packages')
  async removeResourcePackage(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
      @Param('id', ParseIntPipe) id: number
  ): Promise<void> {
    return this.resourcePackageService.removeResourcePackage(workspaceId, id);
  }

  @Delete()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiTags('admin resource-packages')
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'The ID of the workspace',
    required: true
  })
  @ApiQuery({
    name: 'id',
    type: Number,
    isArray: true,
    required: true
  })
  @ApiOkResponse({ description: 'Admin resource-packages deleted successfully.' })
  async removeIds(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
      @Query('id', new ParseArrayPipe({ items: Number, separator: ',' })) id: number[]
  ) : Promise<void> {
    return this.resourcePackageService.removeResourcePackages(workspaceId, id);
  }

  @Get(':name')
  @Header('Content-Disposition', 'filename="resource-package.zip"')
  @Header('Cache-Control', 'none')
  @Header('Content-Type', 'application/zip')
  @UseGuards(JwtAuthGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiBearerAuth()
  @ApiTags('admin resource-packages')
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'The ID of the workspace',
    required: true
  })
  @ApiParam({
    name: 'name',
    type: String,
    description: 'The name of the resource package',
    required: true
  })
  async getZippedResourcePackage(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
      @Param('name') name: string
  ): Promise<StreamableFile> {
    const file = await this.resourcePackageService.getZippedResourcePackage(workspaceId, name);
    return new StreamableFile(file);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiParam({
    name: 'workspaceId',
    type: Number,
    description: 'The ID of the workspace',
    required: true
  })
  @ApiFile('resourcePackage', true, {
    fileFilter: fileMimetypeFilter('application/zip')
  })
  @ApiCreatedResponse({
    description: 'Sends back the id of the new resource package in database',
    type: Number
  })
  @ApiTags('admin resource-packages')
  async create(
    @Param('workspace_id', ParseIntPipe) workspaceId: number,
      @UploadedFile(ParseFile) zippedResourcePackage: Express.Multer.File
  ): Promise<number> {
    return this.resourcePackageService.create(workspaceId, zippedResourcePackage);
  }
}
