import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { TestcenterInstancesService } from '../../testcenter/testcenter-instances.service';
import { TestcenterInstanceDto } from '../../../../../../api-dto/testcenter/testcenter-instance.dto';

@ApiTags('testcenter')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('testcenter/instances')
export class TestcenterInstancesController {
  constructor(private readonly instances: TestcenterInstancesService) {}

  @Get()
  @ApiOperation({ summary: 'List approved Testcenter instances for the import selector' })
  getInstances(): Promise<TestcenterInstanceDto[]> {
    return this.instances.getInstances();
  }
}
