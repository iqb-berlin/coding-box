import type { RequestBody } from '../request-contracts';
import { ApiProperty } from '@nestjs/swagger';

export class LegalNoticeDto {
  @ApiProperty({ description: 'HTML content for the imprint/privacy dialog' })
    html!: string;

  @ApiProperty({ description: 'Whether the content comes from the built-in default' })
    isDefault!: boolean;
}

export type UpdateLegalNoticeDto = RequestBody<'UpdateLegalNoticeDto'>;
