import {
  Controller, Get, Header, HttpStatus, Res
} from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReadinessService, ReadinessStatus } from './readiness.service';

const readinessSchema = {
  type: 'object' as const,
  required: ['status', 'checks'],
  properties: {
    status: { type: 'string' as const, enum: ['ok', 'error', 'shutting_down'] },
    checks: {
      type: 'object' as const,
      properties: {
        database: { type: 'string' as const, enum: ['up', 'down'] },
        redis: { type: 'string' as const, enum: ['up', 'down'] }
      }
    }
  }
};

@ApiTags('Health')
@Controller('health')
export class ReadinessController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: 'PostgreSQL and the queue Redis are available', schema: readinessSchema })
  @ApiServiceUnavailableResponse({ description: 'A dependency is unavailable or shutdown is in progress', schema: readinessSchema })
  async check(@Res({ passthrough: true }) response: Response): Promise<ReadinessStatus> {
    const result = await this.readiness.check();
    response.status(result.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
