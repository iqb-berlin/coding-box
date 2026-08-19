// eslint-disable-next-line max-classes-per-file
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidateNested
} from 'class-validator';
import {
  ApplyDoubleCodedResolutionsRequestDto as ApplyDoubleCodedResolutionsRequestContract,
  DoubleCodedResolutionDecisionDto,
  DoubleCodedReviewQuery,
  SaveDoubleCodedReviewDraftDto as SaveDoubleCodedReviewDraftContract
} from '../../../../../../../api-dto/coding/double-coded-review.dto';

const transformBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

const transformIdList = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null || value === '') return undefined;
  const values = Array.isArray(value) ? value : String(value).split(',');
  return values.map(id => {
    const normalizedId = typeof id === 'string' ? id.trim() : id;
    return /^\d+$/.test(String(normalizedId)) ? Number(normalizedId) : Number.NaN;
  });
};

@ValidatorConstraint({ name: 'exactlyOneReviewSelection', async: false })
class ExactlyOneReviewSelectionConstraint
implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const decision = args.object as DoubleCodedResolutionDecisionRequestDto;
    const hasSelectedJobId = decision.selectedJobId !== undefined &&
      decision.selectedJobId !== null;
    const hasCode = decision.code !== undefined && decision.code !== null;
    return hasSelectedJobId !== hasCode;
  }

  defaultMessage(): string {
    return 'Exactly one of selectedJobId or code must be provided';
  }
}

export class DoubleCodedReviewQueryDto implements DoubleCodedReviewQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
    page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
    limit?: number;

  @IsOptional()
  @Transform(transformBoolean)
  @IsBoolean()
    onlyConflicts?: boolean;

  @IsOptional()
  @Transform(transformBoolean)
  @IsBoolean()
    excludeTrainings?: boolean;

  @IsOptional()
  @Transform(({ value }) => (
    typeof value === 'string' ? value.trim() : value
  ))
  @IsString()
  @MaxLength(255)
    search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
    coderId?: number;

  @IsOptional()
  @IsIn(['all', 'done', 'pending'])
    statusFilter?: 'all' | 'done' | 'pending';

  @IsOptional()
  @IsIn(['all', 'resolved', 'unresolved'])
    resolvedFilter?: 'all' | 'resolved' | 'unresolved';

  @IsOptional()
  @IsIn(['all', 'match', 'differ'])
    agreementFilter?: 'all' | 'match' | 'differ';

  @IsOptional()
  @IsIn(['unitVariable', 'personInfo'])
    sortBy?: 'unitVariable' | 'personInfo';

  @IsOptional()
  @IsIn(['asc', 'desc'])
    sortDirection?: 'asc' | 'desc';

  @IsOptional()
  @Transform(transformIdList)
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
    jobDefinitionIds?: number[];

  @IsOptional()
  @Transform(transformIdList)
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
    coderTrainingIds?: number[];
}

export class DoubleCodedResolutionDecisionRequestDto
implements DoubleCodedResolutionDecisionDto {
  @Validate(ExactlyOneReviewSelectionConstraint)
  private readonly selection?: never;

  @Type(() => Number)
  @IsInt()
  @Min(1)
    responseId: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
    sourceUnitId: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
    selectedJobId?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
    code?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
    score?: number | null;

  @IsOptional()
  @Transform(({ value }) => (
    typeof value === 'string' ? value.trim() : value
  ))
  @IsString()
  @MaxLength(4000)
    resolutionComment?: string;
}

export class ApplyDoubleCodedResolutionsRequestDto
implements ApplyDoubleCodedResolutionsRequestContract {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DoubleCodedResolutionDecisionRequestDto)
    decisions: DoubleCodedResolutionDecisionRequestDto[];
}

export class SaveDoubleCodedReviewDraftRequestDto
implements SaveDoubleCodedReviewDraftContract {
  @Type(() => Number)
  @IsInt()
  @Min(1)
    sourceUnitId: number;

  @Type(() => Number)
  @IsInt()
    code: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
    score?: number | null;

  @IsOptional()
  @Transform(({ value }) => (
    typeof value === 'string' ? value.trim() : value
  ))
  @IsString()
  @MaxLength(4000)
    comment?: string | null;
}
