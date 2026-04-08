import { IsString, IsOptional, IsBoolean } from 'class-validator';
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

  @ApiProperty({
    description: 'If true, only preview without applying changes',
    type: 'boolean',
    required: false
  })
  @IsOptional()
  @IsBoolean()
    previewOnly?: boolean;
}
