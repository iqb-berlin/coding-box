import { PartialType } from '@nestjs/swagger';
import { CreateJobDefinitionDto } from './create-job-definition.dto';

/**
 * DTO for updating a job definition
 */
export class UpdateJobDefinitionDto extends PartialType(CreateJobDefinitionDto) {}
