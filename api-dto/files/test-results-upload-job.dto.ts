import { ApiProperty } from '@nestjs/swagger';

export class TestResultsUploadJobDto {
  @ApiProperty({ type: String, description: 'The ID of the background job handling the upload' })
    jobId!: string;
}
