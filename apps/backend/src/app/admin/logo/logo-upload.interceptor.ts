import { Inject, Injectable } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LogoService } from './logo.service';

@Injectable()
export class LogoUploadInterceptor extends FileInterceptor('logo') {
  constructor(@Inject(LogoService) logoService: LogoService) {
    super(logoService.getUploadOptions());
  }
}
