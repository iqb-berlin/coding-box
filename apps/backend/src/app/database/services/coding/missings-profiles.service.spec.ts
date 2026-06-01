import { BadRequestException } from '@nestjs/common';
import { MissingsProfilesService } from './missings-profiles.service';
import { MissingsProfilesDto } from '../../../../../../../api-dto/coding/missings-profiles.dto';

const createRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
  save: jest.fn(value => Promise.resolve(value)),
  delete: jest.fn()
});

describe('MissingsProfilesService', () => {
  let repo: ReturnType<typeof createRepo>;
  let codingJobRepository: ReturnType<typeof createRepo>;
  let jobDefinitionRepository: ReturnType<typeof createRepo>;
  let service: MissingsProfilesService;

  beforeEach(() => {
    repo = createRepo();
    codingJobRepository = createRepo();
    jobDefinitionRepository = createRepo();
    service = new MissingsProfilesService(
      repo as never,
      codingJobRepository as never,
      jobDefinitionRepository as never
    );
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; error: jest.Mock } }).logger, 'log').mockImplementation(jest.fn());
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; error: jest.Mock } }).logger, 'error').mockImplementation(jest.fn());
  });

  it('returns existing profiles and creates defaults for empty repositories', async () => {
    const defaultMissings = '[]';
    repo.find
      .mockResolvedValueOnce([{ id: 1, label: 'IQB-Standard' }])
      .mockResolvedValueOnce([{ id: 2, label: 'IQB-Standard' }]);
    repo.findOne
      .mockResolvedValueOnce({ id: 1, label: 'IQB-Standard', missings: defaultMissings })
      .mockResolvedValueOnce(null);
    repo.save.mockResolvedValueOnce({ id: 2, label: 'IQB-Standard', missings: defaultMissings });

    await expect(service.getMissingsProfiles(1)).resolves.toEqual([{ id: 1, label: 'IQB-Standard' }]);
    await expect(service.getMissingsProfiles(1)).resolves.toEqual([{ id: 2, label: 'IQB-Standard' }]);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  it('creates IQB standard defaults with score 0 for all standard missings', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    repo.save.mockImplementationOnce(async value => ({ ...value, id: 2 }));

    const profile = await service.ensureDefaultMissingsProfile(1);

    expect(profile.parseMissings()).toEqual([
      expect.objectContaining({ id: 'mci', code: -97, score: 0 }),
      expect.objectContaining({ id: 'mir', code: -98, score: 0 }),
      expect.objectContaining({ id: 'mbi_mbo', code: -99, score: 0 })
    ]);
  });

  it('adds score 0 to legacy IQB standard profiles', async () => {
    repo.findOne.mockResolvedValueOnce({
      id: 7,
      label: 'IQB-Standard',
      missings: JSON.stringify([
        {
          id: 'mci', label: 'MCI', description: '', code: -97
        },
        {
          id: 'mir', label: 'MIR', description: '', code: -98
        },
        {
          id: 'mbi_mbo', label: 'MBI/MBO', description: '', code: -99
        }
      ])
    });
    repo.save.mockImplementationOnce(async value => value);

    const profile = await service.ensureDefaultMissingsProfile(1);

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      label: 'IQB-Standard',
      missings: expect.stringContaining('"score":0')
    }));
    expect(profile.parseMissings().map(missing => missing.score)).toEqual([0, 0, 0]);
  });

  it('adds score 0 to legacy IQB standard profiles resolved by explicit profile id', async () => {
    const legacyProfile = {
      id: 7,
      label: 'IQB-Standard',
      missings: JSON.stringify([
        {
          id: 'mci', label: 'MCI', description: '', code: -97
        },
        {
          id: 'mir', label: 'MIR', description: '', code: -98
        },
        {
          id: 'mbi_mbo', label: 'MBI/MBO', description: '', code: -99
        }
      ])
    };
    repo.findOne.mockResolvedValue(legacyProfile);
    repo.save.mockImplementation(async value => value);

    await expect(service.getMissingByIdForProfileOrDefault(1, 7, 'mir')).resolves.toEqual({
      id: 'mir',
      label: 'MIR',
      code: -98,
      score: 0
    });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 7,
      label: 'IQB-Standard',
      missings: expect.stringContaining('"score":0')
    }));
  });

  it('adds score 0 to legacy IQB standard profiles resolved by label', async () => {
    repo.findOne.mockResolvedValueOnce({
      id: 7,
      label: 'IQB-Standard',
      missings: JSON.stringify([
        {
          id: 'mir', label: 'MIR', description: '', code: -98
        }
      ])
    });
    repo.save.mockImplementationOnce(async value => value);

    const profile = await service.getMissingsProfileByLabel('IQB-Standard');

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 7,
      label: 'IQB-Standard',
      missings: expect.stringContaining('"score":0')
    }));
    expect(profile?.parseMissings()).toEqual([
      expect.objectContaining({ id: 'mir', code: -98, score: 0 })
    ]);
  });

  it('loads profiles by label and id', async () => {
    repo.findOne
      .mockResolvedValueOnce({ label: 'Custom', missings: [{ code: -99 }] })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ label: 'ById', missings: [{ code: -98 }] });

    await expect(service.getMissingsProfileByLabel('Custom')).resolves.toMatchObject({
      label: 'Custom',
      missings: [{ code: -99 }]
    });
    await expect(service.getMissingsProfileByLabel('Missing')).resolves.toBeNull();
    await expect(service.getMissingsProfileDetails(1, 2)).resolves.toMatchObject({
      label: 'ById',
      missings: [{ code: -98 }]
    });
  });

  it('creates, updates and deletes profiles', async () => {
    const profile = new MissingsProfilesDto();
    profile.label = 'Profile';
    profile.setMissings([{
      id: 'x', label: 'X', description: 'X', code: -1, score: 0
    }]);

    repo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 1, label: 'Old', missings: [] })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 2, label: 'Duplicate' })
      .mockResolvedValueOnce({ id: 1, label: 'Profile', missings: profile.missings })
      .mockResolvedValueOnce(null);
    repo.delete.mockResolvedValueOnce({ affected: 1 }).mockResolvedValueOnce({ affected: 0 });

    await expect(service.createMissingsProfile(1, profile)).resolves.toMatchObject({
      label: 'Profile'
    });
    await expect(service.updateMissingsProfile(1, 'Old', profile)).resolves.toMatchObject({
      label: 'Profile'
    });
    await expect(service.createMissingsProfile(1, profile)).resolves.toBeNull();
    await expect(service.deleteMissingsProfile(1, 'Profile')).resolves.toBe(true);
    await expect(service.deleteMissingsProfile(1, 'Profile')).resolves.toBe(false);
  });

  it('creates and updates profiles from plain request bodies', async () => {
    const profile = {
      label: 'Plain',
      missings: JSON.stringify([{
        id: 'x', label: 'X', description: 'X', code: -1, score: 0
      }])
    } as MissingsProfilesDto;

    repo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 1, label: 'Old', missings: profile.missings });

    await expect(service.createMissingsProfile(1, profile)).resolves.toMatchObject({
      label: 'Plain'
    });
    await expect(service.updateMissingsProfile(1, 'Old', profile)).resolves.toMatchObject({
      label: 'Plain'
    });
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty string', ''],
    ['blank string', '  '],
    ['boolean false', false],
    ['empty array', []]
  ])('rejects missing entries when score is %s', async (_label, score) => {
    const missing = {
      id: 'x', label: 'X', description: 'X', code: -1, score
    };
    if (score === undefined) {
      delete (missing as { score?: unknown }).score;
    }

    const profile = {
      label: 'Incomplete',
      missings: JSON.stringify([missing])
    } as MissingsProfilesDto;

    await expect(service.createMissingsProfile(1, profile)).rejects.toThrow('score');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects profile renames to an existing label', async () => {
    const profile = new MissingsProfilesDto();
    profile.label = 'Duplicate';
    profile.setMissings([{
      id: 'x', label: 'X', description: 'X', code: -1, score: 0
    }]);

    repo.findOne
      .mockResolvedValueOnce({ id: 1, label: 'Old', missings: profile.missings })
      .mockResolvedValueOnce({ id: 2, label: 'Duplicate', missings: profile.missings });

    await expect(service.updateMissingsProfile(1, 'Old', profile)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('resolves IQB standard as default profile and derives all negative default codes', async () => {
    const profile = new MissingsProfilesDto();
    profile.id = 7;
    profile.label = 'IQB-Standard';
    profile.setMissings([
      {
        id: 'mci', label: 'missing coding impossible', description: '', code: -97, score: 0
      },
      {
        id: 'mir', label: 'missing invalid response', description: '', code: -98, score: 0
      },
      {
        id: 'mbi_mbo', label: 'mbi / mbo', description: '', code: -99, score: 0
      }
    ]);
    repo.findOne.mockResolvedValue({
      id: profile.id,
      label: profile.label,
      missings: profile.missings
    });

    await expect(service.resolveMissingsProfileId(1, undefined)).resolves.toBe(7);
    await expect(service.getDefaultNegativeMissingCodes(1)).resolves.toEqual(new Set([-97, -98, -99]));
    await expect(service.getNegativeMissingCodesForProfileOrDefault(1, 0)).resolves.toEqual(new Set([-97, -98, -99]));
  });

  it('resolves missing code and score by missing id', async () => {
    const profile = new MissingsProfilesDto();
    profile.id = 7;
    profile.label = 'IQB-Standard';
    profile.setMissings([
      {
        id: 'mir', label: 'missing invalid response', description: '', code: -98, score: 0
      }
    ]);
    repo.findOne.mockResolvedValue({
      id: profile.id,
      label: profile.label,
      missings: profile.missings
    });

    await expect(service.getMissingByIdForProfileOrDefault(1, 0, 'mir')).resolves.toEqual({
      id: 'mir',
      label: 'missing invalid response',
      code: -98,
      score: 0
    });
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty string', ''],
    ['blank string', '  '],
    ['boolean false', false],
    ['empty array', []]
  ])('rejects profile missing resolution when score is %s', async (_label, score) => {
    const profile = new MissingsProfilesDto();
    profile.id = 8;
    profile.label = 'Legacy';
    const missing = {
      id: 'mir', label: 'missing invalid response', description: '', code: -98, score
    };
    if (score === undefined) {
      delete (missing as { score?: unknown }).score;
    }
    profile.missings = JSON.stringify([
      missing
    ]);
    repo.findOne
      .mockResolvedValueOnce({ id: profile.id, label: profile.label, missings: profile.missings })
      .mockResolvedValueOnce({ id: profile.id, label: profile.label, missings: profile.missings });

    await expect(service.getMissingByIdForProfileOrDefault(1, 8, 'mir')).rejects.toThrow('score');
  });

  it('rejects unknown explicit profile ids', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.resolveMissingsProfileId(1, 99)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks updates and deletes for referenced profiles', async () => {
    const profile = new MissingsProfilesDto();
    profile.label = 'Used';
    profile.setMissings([{
      id: 'x', label: 'X', description: '', code: -96, score: 0
    }]);
    repo.findOne.mockResolvedValue({ id: 5, label: 'Used', missings: profile.missings });
    codingJobRepository.count.mockResolvedValue(1);

    await expect(service.updateMissingsProfile(1, 'Used', profile)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteMissingsProfile(1, 'Used')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('blocks updates and deletes for the default profile when legacy jobs use it implicitly', async () => {
    const profile = new MissingsProfilesDto();
    profile.label = 'IQB-Standard';
    profile.setMissings([{
      id: 'mci', label: 'MCI', description: '', code: -97, score: 0
    }]);
    repo.findOne.mockResolvedValue({ id: 7, label: 'IQB-Standard', missings: profile.missings });
    codingJobRepository.count.mockImplementation(async ({ where }) => (Array.isArray(where) ? 1 : 0));

    await expect(service.updateMissingsProfile(1, 'IQB-Standard', profile)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteMissingsProfile(1, 'IQB-Standard')).rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobRepository.count).toHaveBeenCalledWith({
      where: expect.arrayContaining([
        { missings_profile_id: 7 },
        expect.objectContaining({ missings_profile_id: expect.any(Object) })
      ])
    });
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
