import {
  IsString, IsInt, IsNumber, Min, IsBoolean, IsOptional
} from 'class-validator';

export class TestGroupsInfoDto {
  @IsString()
    groupName!: string;

  @IsString()
    groupLabel!: string;

  @IsInt()
    bookletsStarted!: number;

  @IsInt()
  @Min(0)
    numUnitsMin!: number;

  @IsInt()
  @Min(0)
    numUnitsMax!: number;

  @IsInt()
  @Min(0)
    numUnitsTotal!: number;

  @IsNumber()
  @Min(0)
    numUnitsAvg!: number;

  @IsInt()
  @Min(0)
    lastChange!: number;

  @IsBoolean()
  @IsOptional()
    existsInDatabase?: boolean;
}
