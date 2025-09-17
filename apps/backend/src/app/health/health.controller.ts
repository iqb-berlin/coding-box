import { Controller, Get, Logger } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { JobQueueService, RedisConnectionStatus } from '../job-queue/job-queue.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly jobQueueService: JobQueueService) {}

  /**
   * Check if Redis is connected and jobs can be managed
   * @returns Redis connection status
   */
  @Get('redis')
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
    return this.jobQueueService.checkRedisConnection();
  }
}
