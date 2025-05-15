import { IsOptional, IsString } from 'class-validator';

export class ImportWorkspaceFilesDto {
  @IsOptional()
  @IsString()
    server?: string;

  @IsOptional()
  @IsString()
    url?: string;

  @IsOptional()
  @IsString()
    tc_workspace?: string;

  @IsOptional()
  @IsString()
    token?: string;

  @IsOptional()
  @IsString()
    definitions?: string;

  @IsOptional()
  @IsString()
    responses?: string;

  @IsOptional()
  @IsString()
    logs?: string;

  @IsOptional()
  @IsString()
    player?: string;

  @IsOptional()
  @IsString()
    units?: string;

  @IsOptional()
  @IsString()
    codings?: string;

  @IsOptional()
  @IsString()
    testTakers?: string;

  @IsOptional()
  @IsString()
    booklets?: string;
}
