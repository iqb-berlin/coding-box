import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ExternalCodingImportDto {
  @ApiProperty({
    description: 'Base64 encoded file data (CSV or Excel)',
    type: 'string'
  })
  @IsString()
    file!: string;

  @ApiProperty({
    description: 'Optional filename',
    type: 'string',
    required: false
  })
  @IsOptional()
  @IsString()
    fileName?: string;
}
