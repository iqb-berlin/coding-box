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

  @ApiProperty({
    description: 'Detected source format',
    type: 'string',
    required: false,
    enum: ['external-coding', 'coding-list', 'coding-results']
  })
  @IsOptional()
  @IsString()
    sourceFormat?: 'external-coding' | 'coding-list' | 'coding-results';

  @ApiProperty({
    description: 'Source coding version when importing a coding results export',
    type: 'string',
    required: false,
    enum: ['v1', 'v2', 'v3']
  })
  @IsOptional()
  @IsString()
    sourceVersion?: 'v1' | 'v2' | 'v3';

  @ApiProperty({
    description: 'Whether scores should be imported from the file or derived from the coding scheme',
    type: 'string',
    required: false,
    enum: ['import', 'derive']
  })
  @IsOptional()
  @IsString()
    scoreMode?: 'import' | 'derive';

  @ApiProperty({
    description: 'How existing manual codings in v2 should be handled',
    type: 'string',
    required: false,
    enum: ['skip-conflicts', 'fill-empty', 'overwrite']
  })
  @IsOptional()
  @IsString()
    existingCodingMode?: 'skip-conflicts' | 'fill-empty' | 'overwrite';
}
