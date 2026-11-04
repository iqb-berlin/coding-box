import {
  Controller, Delete, Get, Post, UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RequestBody } from '../../../../../../api-dto/request-contracts';
import { ValidatedBody } from '../../http/validated-body.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../admin.guard';
import { TestcenterInstancesService } from '../../testcenter/testcenter-instances.service';
import { TestcenterConnectionTestDto, TestcenterInstanceDto } from '../../../../../../api-dto/testcenter/testcenter-instance.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/testcenter/instances')
export class AdminTestcenterInstancesController {
  constructor(private readonly instances: TestcenterInstancesService) {}

  @Get()
  @ApiOperation({ summary: 'List Testcenter instances and their configuration source' })
  getInstances(): Promise<TestcenterInstanceDto[]> {
    return this.instances.getInstances();
  }

  @Post()
  @ApiOperation({ summary: 'Approve an HTTPS Testcenter instance or update its name' })
  saveInstance(@ValidatedBody('TestcenterInstanceInput') input: RequestBody<'TestcenterInstanceInput'>): Promise<TestcenterInstanceDto[]> {
    return this.instances.saveInstance(input);
  }

  @Delete()
  @ApiOperation({ summary: 'Revoke an instance approved through the administration UI' })
  deleteInstance(@ValidatedBody('TestcenterTargetInput') input: RequestBody<'TestcenterTargetInput'>): Promise<TestcenterInstanceDto[]> {
    return this.instances.deleteInstance(input.baseUrl);
  }

  @Post('test')
  @ApiOperation({ summary: 'Check approved Testcenter reachability, TLS trust and reported version; does not verify data access' })
  testConnection(@ValidatedBody('TestcenterTargetInput') input: RequestBody<'TestcenterTargetInput'>): Promise<TestcenterConnectionTestDto> {
    return this.instances.testConnection(input.baseUrl);
  }
}
