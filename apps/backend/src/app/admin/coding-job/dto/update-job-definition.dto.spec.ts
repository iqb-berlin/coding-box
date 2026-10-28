import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateJobDefinitionDto } from './update-job-definition.dto';

describe('UpdateJobDefinitionDto', () => {
  it.each(['durationSeconds', 'maxCodingCases', 'doubleCodingAbsolute'])(
    'retains PostgreSQL integer bounds on partial %s updates', async field => {
      const dto = plainToInstance(UpdateJobDefinitionDto, { [field]: 2147483648 });
      expect((await validate(dto)).some(error => error.property === field)).toBe(true);
    }
  );

  it('still accepts clearing an optional case limit', async () => {
    expect(await validate(plainToInstance(UpdateJobDefinitionDto, { maxCodingCases: null }))).toHaveLength(0);
  });

  it('accepts a partial metadata update and normalizes an empty description', async () => {
    const dto = plainToInstance(UpdateJobDefinitionDto, {
      name: '  Lesen Klasse 4  ',
      description: '   '
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('Lesen Klasse 4');
    expect(dto.description).toBeNull();
  });

  it('rejects null as a job definition name', async () => {
    const dto = plainToInstance(UpdateJobDefinitionDto, {
      name: null
    });

    const errors = await validate(dto);

    expect(errors.some(error => error.property === 'name')).toBe(true);
  });

  it('does not expose distributionSeed as an updatable field', async () => {
    const dto = plainToInstance(UpdateJobDefinitionDto, {
      maxCodingCases: 10,
      distributionSeed: 'frontend-seed'
    });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.some(error => error.property === 'distributionSeed')).toBe(true);
  });
});
