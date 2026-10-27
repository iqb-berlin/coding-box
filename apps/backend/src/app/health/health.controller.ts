import {
  Controller, Get, Logger, ServiceUnavailableException
} from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { RedisConnectionStatus } from '../job-queue/job-queue.service';
import { ReadinessService, ReadinessStatus } from './readiness.service';

export interface ApplicationHealthStatus {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly readiness: ReadinessService) {}

  @Get('ready')
  @ApiOkResponse({ description: 'Database and Redis are reachable' })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unavailable or timed out' })
  async checkReadiness(): Promise<ReadinessStatus> {
    const result = await this.readiness.check();
    if (result.status !== 'ok') throw new ServiceUnavailableException(result);
    return result;
  }

  @Get()
  @ApiOkResponse({
    description: 'Application health status',
    type: Object,
    schema: {
      properties: {
        status: {
          type: 'string',
          example: 'ok'
        },
        uptime: {
          type: 'number',
          description: 'Node.js process uptime in seconds'
        },
        timestamp: {
          type: 'string',
          format: 'date-time'
        }
      }
    }
  })
  checkApplication(): ApplicationHealthStatus {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Check if Redis is connected and jobs can be managed
   * @returns Redis connection status
   */
  @Get('redis')
  @ApiServiceUnavailableResponse({ description: 'Redis is unavailable or timed out' })
  @ApiOkResponse({
    description: 'Redis connection status',
    type: Object,
    schema: {
      properties: {
        connected: {
          type: 'boolean',
          description: 'Whether Redis is connected'
        },
        message: {
          type: 'string',
          description: 'Status message'
        },
        details: {
          type: 'object',
          properties: {
            pingLatency: {
              type: 'number',
              description: 'Redis ping latency in milliseconds'
            },
            queueStatus: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Queue name'
                },
                isReady: {
                  type: 'boolean',
                  description: 'Whether the queue is ready'
                },
                jobCounts: {
                  type: 'object',
                  properties: {
                    waiting: {
                      type: 'number',
                      description: 'Number of waiting jobs'
                    },
                    active: {
                      type: 'number',
                      description: 'Number of active jobs'
                    },
                    completed: {
                      type: 'number',
                      description: 'Number of completed jobs'
                    },
                    failed: {
                      type: 'number',
                      description: 'Number of failed jobs'
                    },
                    delayed: {
                      type: 'number',
                      description: 'Number of delayed jobs'
                    },
                    paused: {
                      type: 'number',
                      description: 'Number of paused jobs'
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  })
  async checkRedisConnection(): Promise<RedisConnectionStatus> {
    this.logger.log('Health check: Checking Redis connection');
    const result = await this.readiness.redisStatus();
    if (!result.connected || result.details?.queueStatus?.isReady === false) {
      throw new ServiceUnavailableException('Redis is unavailable');
    }
    return result;
  }
}
