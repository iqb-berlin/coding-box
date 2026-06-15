import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateJobDefinitionDto } from './create-job-definition.dto';

describe('CreateJobDefinitionDto', () => {
  it('accepts a bounded distribution seed', async () => {
    const dto = plainToInstance(CreateJobDefinitionDto, {
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      distributionSeed: `job-definition:7:${'a'.repeat(32)}`
    });

    const errors = await validate(dto);

    expect(errors.some(error => error.property === 'distributionSeed')).toBe(false);
  });

  it('rejects oversized distribution seeds', async () => {
    const dto = plainToInstance(CreateJobDefinitionDto, {
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      distributionSeed: 'x'.repeat(129)
    });

    const errors = await validate(dto);

    expect(errors.some(error => error.property === 'distributionSeed')).toBe(true);
  });
});
