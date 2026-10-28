import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateJobDefinitionDto } from './create-job-definition.dto';

describe('CreateJobDefinitionDto', () => {
  it.each(['durationSeconds', 'maxCodingCases', 'doubleCodingAbsolute'])(
    'rejects %s outside the PostgreSQL integer range', async field => {
      const dto = plainToInstance(CreateJobDefinitionDto, { name: 'Job', [field]: 2147483648 });
      expect((await validate(dto)).some(error => error.property === field)).toBe(true);
    }
  );

  it('rejects oversized coder IDs in the nested configuration', async () => {
    const dto = plainToInstance(CreateJobDefinitionDto, {
      name: 'Job', assignedCoderConfigs: [{ coderId: 2147483648, capacityPercent: 100 }]
    });
    expect((await validate(dto)).some(error => error.property === 'assignedCoderConfigs')).toBe(true);
  });

  it('accepts integer limits, fractional percentages and the default profile', async () => {
    const dto = plainToInstance(CreateJobDefinitionDto, {
      name: 'Job',
      durationSeconds: 2147483647,
      maxCodingCases: 2147483647,
      doubleCodingAbsolute: 2147483647,
      doubleCodingPercentage: 25.5,
      missingsProfileId: 0,
      assignedCoderConfigs: [{ coderId: 2147483647, capacityPercent: 100 }]
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('trims and accepts a required name with an optional description', async () => {
    const dto = plainToInstance(CreateJobDefinitionDto, {
      name: '  Lesen Klasse 4  ',
      description: '  Erste Kodierwelle  '
    });

    const errors = await validate(dto);

    expect(errors.some(error => error.property === 'name')).toBe(false);
    expect(errors.some(error => error.property === 'description')).toBe(false);
    expect(dto.name).toBe('Lesen Klasse 4');
    expect(dto.description).toBe('Erste Kodierwelle');
  });

  it.each([
    {},
    { name: '   ' },
    { name: 'x'.repeat(256) }
  ])('rejects a missing, blank, or oversized name', async input => {
    const dto = plainToInstance(CreateJobDefinitionDto, input);

    const errors = await validate(dto);

    expect(errors.some(error => error.property === 'name')).toBe(true);
  });

  it('normalizes an empty description to null', async () => {
    const dto = plainToInstance(CreateJobDefinitionDto, {
      name: 'Lesen Klasse 4',
      description: '   '
    });

    const errors = await validate(dto);

    expect(errors.some(error => error.property === 'description')).toBe(false);
    expect(dto.description).toBeNull();
  });

  it('accepts a bounded distribution seed', async () => {
    const dto = plainToInstance(CreateJobDefinitionDto, {
      name: 'Lesen Klasse 4',
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      distributionSeed: `job-definition:7:${'a'.repeat(32)}`
    });

    const errors = await validate(dto);

    expect(errors.some(error => error.property === 'distributionSeed')).toBe(false);
  });

  it('rejects oversized distribution seeds', async () => {
    const dto = plainToInstance(CreateJobDefinitionDto, {
      name: 'Lesen Klasse 4',
      assignedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
      assignedCoders: [1],
      distributionSeed: 'x'.repeat(129)
    });

    const errors = await validate(dto);

    expect(errors.some(error => error.property === 'distributionSeed')).toBe(true);
  });
});
