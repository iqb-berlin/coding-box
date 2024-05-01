import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  // eslint-disable-next-line class-methods-use-this
  async uploadResults(originalFiles): Promise<any> {
    const files: any[] = [];
    for (const file of originalFiles) {
      files.push({
        name: file.originalname,
        data: file.buffer
      });
    }
  }
}
