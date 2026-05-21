import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ResourcePackageDto {
  @ApiProperty()
    id!: number;

  @ApiProperty()
    workspaceId?: number;

  @ApiProperty()
    name!: string;

  @ApiProperty()
  @IsString({ each: true })
  @IsNotEmpty()
    elements!: string[];

  @ApiProperty()
    packageType?: 'resource' | 'geogebra';

  @ApiProperty()
    scope?: 'workspace' | 'global';

  @ApiProperty()
    detectedVersion?: string | null;

  @ApiProperty()
    contentHash?: string | null;

  @ApiProperty()
    originalFilename?: string | null;

  @ApiProperty()
    packageSize?: number;

  @ApiProperty()
    createdAt?: Date;
}
