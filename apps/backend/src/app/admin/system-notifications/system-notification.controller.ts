import {
  Controller,
  Get
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from '@nestjs/swagger';
import {
  SystemNotificationDto
} from '../../../../../../api-dto/system-notifications/system-notification.dto';
import { SystemNotificationService } from './system-notification.service';

@ApiTags('system-notifications')
@Controller('system-notifications')
export class PublicSystemNotificationController {
  constructor(private readonly service: SystemNotificationService) {}

  @Get('active')
  @ApiOperation({ summary: 'List currently visible system notifications' })
  @ApiOkResponse({ type: [SystemNotificationDto] })
  findActive(): Promise<SystemNotificationDto[]> {
    return this.service.findActive();
  }
}
