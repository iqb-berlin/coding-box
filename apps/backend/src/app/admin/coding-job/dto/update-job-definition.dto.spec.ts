import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateJobDefinitionDto } from './update-job-definition.dto';

describe('UpdateJobDefinitionDto', () => {
  it('does not expose distributionSeed as an updatable field', async () => {
    const dto = plainToInstance(UpdateJobDefinitionDto, {
      maxCodingCases: 10,
      distributionSeed: 'frontend-seed'
    });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some(error => error.property === 'distributionSeed')).toBe(true);
  });
});
