import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
  ValidationPipe
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags
} from '@nestjs/swagger';
import {
  RequestMonitoringIncidentDto,
  ResolveRequestMonitoringIncidentDto
} from '../../../../../../api-dto/request-monitoring/request-monitoring-incident.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../admin.guard';
import { RequestMonitoringIncidentService } from './request-monitoring-incident.service';

@ApiTags('admin/request-monitoring-incidents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/request-monitoring-incidents')
export class RequestMonitoringIncidentController {
  constructor(private readonly service: RequestMonitoringIncidentService) {}

  @Get()
  @ApiOkResponse({ type: [RequestMonitoringIncidentDto] })
  findAll(
    @Query('includeResolved', new DefaultValuePipe(false), ParseBoolPipe)
      includeResolved: boolean,
      @Query('limit', new DefaultValuePipe(200), ParseIntPipe)
      limit: number
  ): Promise<RequestMonitoringIncidentDto[]> {
    return this.service.findAll(includeResolved, limit);
  }

  @Patch(':id/resolution')
  @ApiOkResponse({ type: RequestMonitoringIncidentDto })
  setResolved(
    @Param('id', ParseIntPipe) id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true })) input: ResolveRequestMonitoringIncidentDto
  ): Promise<RequestMonitoringIncidentDto> {
    return this.service.setResolved(id, input.resolved);
  }
}
