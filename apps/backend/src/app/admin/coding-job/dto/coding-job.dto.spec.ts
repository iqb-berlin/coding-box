import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CodingJobDto } from './coding-job.dto';
import { CodingJob } from '../../../database/entities/coding-job.entity';

describe('CodingJobDto', () => {
  it('documents nullable comments as strings', async () => {
    const module = await Test.createTestingModule({}).compile();
    const app = module.createNestApplication();
    try {
      const document = SwaggerModule.createDocument(app, new DocumentBuilder().build(), { extraModels: [CodingJobDto] });
      const schema = document.components?.schemas?.CodingJobDto;
      if (!schema || '$ref' in schema) throw new Error('Missing coding job schema');
      expect(schema.properties?.comment).toMatchObject({ type: 'string', nullable: true });
    } finally {
      await app.close();
    }
  });

  it('exposes the job definition id in snake_case and camelCase', () => {
    const dto = CodingJobDto.fromEntity({
      id: 12,
      workspace_id: 5,
      name: 'Job',
      status: 'pending',
      showScore: true,
      allowComments: true,
      suppressGeneralInstructions: false,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-02T00:00:00.000Z'),
      job_definition_id: 99,
      aggregation_enabled: true,
      aggregation_threshold: 4,
      response_matching_flags: [],
      aggregation_settings_version: 1
    } as CodingJob);

    expect(dto.job_definition_id).toBe(99);
    expect(dto.jobDefinitionId).toBe(99);
  });
});
