import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  ValidationPipe,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags
} from '@nestjs/swagger';
import {
  CreateSystemNotificationDto,
  SystemNotificationDto,
  UpdateSystemNotificationDto
} from '../../../../../../api-dto/system-notifications/system-notification.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../admin.guard';
import { SystemNotificationService } from './system-notification.service';

const requestValidationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true
});

@ApiTags('admin/system-notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/system-notifications')
export class AdminSystemNotificationController {
  constructor(private readonly service: SystemNotificationService) {}

  @Get()
  @ApiOkResponse({ type: [SystemNotificationDto] })
  findAll(): Promise<SystemNotificationDto[]> {
    return this.service.findAll();
  }

  @Post()
  @ApiCreatedResponse({ type: SystemNotificationDto })
  create(
    @Body(requestValidationPipe) input: CreateSystemNotificationDto
  ): Promise<SystemNotificationDto> {
    return this.service.create(input);
  }

  @Put(':id')
  @ApiOkResponse({ type: SystemNotificationDto })
  update(
    @Param('id', ParseIntPipe) id: number,
      @Body(requestValidationPipe) input: UpdateSystemNotificationDto
  ): Promise<SystemNotificationDto> {
    return this.service.update(id, input);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.service.delete(id);
  }
}
