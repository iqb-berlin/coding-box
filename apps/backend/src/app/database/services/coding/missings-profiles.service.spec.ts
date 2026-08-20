import { BadRequestException } from '@nestjs/common';
import { MissingsProfilesService } from './missings-profiles.service';
import { MissingsProfilesDto } from '../../../../../../../api-dto/coding/missings-profiles.dto';
import { getCodingIncompleteVariablesCacheVersionKey } from './coding-incomplete-variables-cache-key.util';

const createRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  count: jest.fn().mockResolvedValue(0),
  save: jest.fn(value => Promise.resolve(value)),
  delete: jest.fn()
});

const setValidMissings = (profile: MissingsProfilesDto): void => {
  profile.setMissings([
    {
      id: 'mir', label: 'MIR', description: 'Invalid response', code: -98, score: 0
    },
    {
      id: 'mci', label: 'MCI', description: 'Coding impossible', code: -97, score: 0
    }
  ]);
};

describe('MissingsProfilesService', () => {
  let repo: ReturnType<typeof createRepo>;
  let codingJobRepository: ReturnType<typeof createRepo>;
  let jobDefinitionRepository: ReturnType<typeof createRepo>;
  let cacheService: { incr: jest.Mock };
  let service: MissingsProfilesService;

  beforeEach(() => {
    repo = createRepo();
    codingJobRepository = createRepo();
    jobDefinitionRepository = createRepo();
    cacheService = { incr: jest.fn().mockResolvedValue(1) };
    service = new MissingsProfilesService(
      repo as never,
      codingJobRepository as never,
      jobDefinitionRepository as never,
      cacheService as never
    );
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; error: jest.Mock } }).logger, 'log').mockImplementation(jest.fn());
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; error: jest.Mock } }).logger, 'error').mockImplementation(jest.fn());
  });

  it('resolves an export profile strictly without writing it', async () => {
    repo.findOne.mockResolvedValueOnce({
      id: 7,
      workspace_id: 1,
      label: 'Custom',
      missings: JSON.stringify([
        {
          id: 'mir', label: 'MIR', code: -18, score: 0
        },
        {
          id: 'mci', label: 'MCI', code: -17, score: null
        },
        {
          id: 'mbi_mbo', label: 'MBO', code: -19, score: 0
        },
        {
          id: 'mnr', label: 'MNR', code: -16, score: null
        }
      ])
    });

    const resolved = await service.getResolvedMissingsProfileForExport(
      1,
      7,
      ['mir', 'mci', 'mbi_mbo', 'mnr']
    );

    expect(resolved.byId.get('mnr')).toEqual(expect.objectContaining({
      code: -16,
      score: null
    }));
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects an export profile missing a required id', async () => {
    repo.findOne.mockResolvedValueOnce({
      id: 7,
      workspace_id: 1,
      label: 'Incomplete',
      missings: JSON.stringify([
        {
          id: 'mir', label: 'MIR', code: -18, score: 0
        }
      ])
    });

    await expect(service.getResolvedMissingsProfileForExport(
      1,
      7,
      ['mir', 'mci']
    )).rejects.toThrow("Missing profile 7 must define 'mci'");
  });

  it.each([
    [
      'non-negative code',
      [
        {
          id: 'mir', label: 'MIR', code: 0, score: 0
        },
        {
          id: 'mci', label: 'MCI', code: -17, score: null
        }
      ],
      "Missing 'mir' in profile 7 must define a negative integer code"
    ],
    [
      'duplicate id',
      [
        {
          id: 'mir', label: 'MIR', code: -18, score: 0
        },
        {
          id: 'mir', label: 'MIR duplicate', code: -17, score: null
        }
      ],
      "Duplicate missing id 'mir' in profile 7"
    ],
    [
      'duplicate code',
      [
        {
          id: 'mir', label: 'MIR', code: -18, score: 0
        },
        {
          id: 'mci', label: 'MCI', code: -18, score: null
        }
      ],
      "Duplicate missing code '-18' in profile 7"
    ]
  ] as const)(
    'rejects an export profile with a %s',
    async (_case, missings, error) => {
      repo.findOne.mockResolvedValueOnce({
        id: 7,
        workspace_id: 1,
        label: 'Invalid',
        missings: JSON.stringify(missings)
      });

      await expect(service.getResolvedMissingsProfileForExport(
        1,
        7,
        ['mir', 'mci']
      )).rejects.toThrow(error);
    }
  );

  it.each([-1, -2, -3, -4, -111])(
    'rejects reserved technical code %s in an export profile',
    async code => {
      repo.findOne.mockResolvedValueOnce({
        id: 7,
        workspace_id: 1,
        label: 'Reserved',
        missings: JSON.stringify([
          {
            id: 'mir', label: 'MIR', code, score: 0
          },
          {
            id: 'mci', label: 'MCI', code: -17, score: null
          }
        ])
      });

      await expect(service.getResolvedMissingsProfileForExport(
        1,
        7,
        ['mir', 'mci']
      )).rejects.toThrow(`reserved technical code '${code}'`);
    }
  );

  it('lists export profiles without creating or updating profiles', async () => {
    repo.find.mockResolvedValueOnce([
      { id: 7, label: 'Custom' },
      { id: 4, label: 'IQB-Standard' }
    ]);

    await expect(service.getMissingsProfilesForExport(1)).resolves.toEqual([
      { id: 7, label: 'Custom' },
      { id: 4, label: 'IQB-Standard' }
    ]);

    expect(repo.find).toHaveBeenCalledWith({
      where: { workspace_id: 1 },
      select: ['id', 'label']
    });
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('propagates read-only export profile loading errors', async () => {
    repo.find.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.getMissingsProfilesForExport(1))
      .rejects.toThrow('database unavailable');
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
    expect(repo.save).toHaveBeenCalledTimes(2);
  });

  it('creates canonical IQB standard defaults with explicit NA scores', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    repo.save.mockImplementationOnce(async value => ({ ...value, id: 2 }));

    const profile = await service.ensureDefaultMissingsProfile(1);

    expect(profile.parseMissings()).toEqual([
      expect.objectContaining({ id: 'mir', code: -98, score: 0 }),
      expect.objectContaining({ id: 'mbi_mbo', code: -99, score: 0 }),
      expect.objectContaining({ id: 'mnr', code: -96, score: null }),
      expect.objectContaining({ id: 'mci', code: -97, score: null }),
      expect.objectContaining({ id: 'mbd', code: -94, score: null })
    ]);
  });

  it('returns the same default profile when concurrent creation loses the unique constraint race', async () => {
    let persistedProfile: Record<string, unknown> | null = null;
    repo.findOne.mockImplementation(async () => persistedProfile);
    repo.save.mockImplementation(async value => {
      if (persistedProfile) {
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505'
        });
      }

      persistedProfile = { ...value, id: 2 };
      return persistedProfile;
    });

    const [firstProfile, secondProfile] = await Promise.all([
      service.ensureDefaultMissingsProfile(1),
      service.ensureDefaultMissingsProfile(1)
    ]);

    expect(firstProfile.id).toBe(2);
    expect(secondProfile.id).toBe(2);
    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(repo.findOne).toHaveBeenCalledTimes(3);
  });

  it('synchronizes legacy IQB standard profiles to the canonical missings', async () => {
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
      missings: expect.stringContaining('"id":"mbd"')
    }));
    expect(profile.parseMissings()).toEqual([
      expect.objectContaining({ id: 'mir', code: -98, score: 0 }),
      expect.objectContaining({ id: 'mbi_mbo', code: -99, score: 0 }),
      expect.objectContaining({ id: 'mnr', code: -96, score: null }),
      expect.objectContaining({ id: 'mci', code: -97, score: null }),
      expect.objectContaining({ id: 'mbd', code: -94, score: null })
    ]);
  });

  it('synchronizes legacy IQB standard profiles resolved by explicit profile id', async () => {
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

    await expect(service.getMissingByIdForProfileOrDefault(1, 7, 'mci')).resolves.toEqual({
      id: 'mci',
      label: 'missing coding impossible',
      code: -97,
      score: null
    });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 7,
      label: 'IQB-Standard',
      missings: expect.stringContaining('"score":null')
    }));
  });

  it('synchronizes legacy IQB standard profiles resolved by label', async () => {
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

    const profile = await service.getMissingsProfileByLabel(1, 'IQB-Standard');

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 7,
      label: 'IQB-Standard',
      missings: expect.stringContaining('"id":"mnr"')
    }));
    expect(profile?.parseMissings()).toHaveLength(5);
    expect(profile?.parseMissings()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mir', code: -98, score: 0 }),
      expect.objectContaining({ id: 'mci', code: -97, score: null })
    ]));
  });

  it('loads profiles by label and id', async () => {
    repo.findOne
      .mockResolvedValueOnce({ label: 'Custom', missings: [{ code: -99 }] })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ label: 'ById', missings: [{ code: -98 }] });

    await expect(service.getMissingsProfileByLabel(1, 'Custom')).resolves.toMatchObject({
      label: 'Custom',
      missings: [{ code: -99 }]
    });
    await expect(service.getMissingsProfileByLabel(1, 'Missing')).resolves.toBeNull();
    await expect(service.getMissingsProfileDetails(1, 2)).resolves.toMatchObject({
      label: 'ById',
      missings: [{ code: -98 }]
    });
  });

  it('creates, updates and deletes profiles', async () => {
    const profile = new MissingsProfilesDto();
    profile.label = 'Profile';
    setValidMissings(profile);

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
    expect(cacheService.incr).toHaveBeenCalledTimes(3);
    expect(cacheService.incr).toHaveBeenNthCalledWith(
      1,
      getCodingIncompleteVariablesCacheVersionKey(1)
    );
    expect(cacheService.incr).toHaveBeenNthCalledWith(
      2,
      getCodingIncompleteVariablesCacheVersionKey(1)
    );
    expect(cacheService.incr).toHaveBeenNthCalledWith(
      3,
      getCodingIncompleteVariablesCacheVersionKey(1)
    );
  });

  it('creates and updates profiles from plain request bodies', async () => {
    const profile = {
      label: 'Plain',
      missings: JSON.stringify([
        {
          id: 'mir', label: 'MIR', description: 'Invalid response', code: -98, score: 0
        },
        {
          id: 'mci', label: 'MCI', description: 'Coding impossible', code: -97, score: 0
        }
      ])
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
    ['empty string', ''],
    ['blank string', '  '],
    ['boolean false', false],
    ['empty array', []]
  ])('rejects missing entries when score is %s', async (_label, score) => {
    const missing = {
      id: 'x', label: 'X', description: 'X', code: -95, score
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

  it.each([-1, -2, -3, -4, -111])(
    'rejects reserved technical code %s when storing a profile',
    async code => {
      const profile = new MissingsProfilesDto();
      profile.label = 'Reserved';
      profile.setMissings([
        {
          id: 'mir', label: 'MIR', description: 'Invalid response', code, score: 0
        },
        {
          id: 'mci', label: 'MCI', description: 'Coding impossible', code: -97, score: null
        }
      ]);

      await expect(service.createMissingsProfile(1, profile)).rejects.toThrow(
        `reserved technical code '${code}'`
      );
      expect(repo.save).not.toHaveBeenCalled();
    }
  );

  it('accepts explicit null as a fachlicher NA score', async () => {
    const profile = new MissingsProfilesDto();
    profile.label = 'Profile';
    profile.setMissings([
      {
        id: 'mir', label: 'MIR', description: 'Invalid response', code: -98, score: 0
      },
      {
        id: 'mci', label: 'MCI', description: 'Coding impossible', code: -97, score: null
      }
    ]);
    repo.findOne.mockResolvedValueOnce(null);

    await expect(service.createMissingsProfile(1, profile)).resolves.toMatchObject({
      label: 'Profile'
    });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      missings: expect.stringContaining('"score":null')
    }));
  });

  it('rejects malformed missings JSON', async () => {
    const profile = {
      label: 'Malformed',
      missings: '[not json'
    } as MissingsProfilesDto;

    await expect(service.createMissingsProfile(1, profile)).rejects.toThrow('valid JSON');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects profiles without MIR and MCI entries', async () => {
    const profile = {
      label: 'Incomplete',
      missings: JSON.stringify([{
        id: 'mir', label: 'MIR', description: 'Invalid response', code: -98, score: 0
      }])
    } as MissingsProfilesDto;

    await expect(service.createMissingsProfile(1, profile)).rejects.toThrow("'mci'");
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('keeps duplicate profile labels scoped to a workspace', async () => {
    const profile = new MissingsProfilesDto();
    profile.label = 'Profile';
    setValidMissings(profile);
    repo.findOne.mockResolvedValueOnce(null);

    await expect(service.createMissingsProfile(2, profile)).resolves.toMatchObject({
      label: 'Profile'
    });

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { workspace_id: 2, label: 'Profile' }
    });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: 2,
      label: 'Profile'
    }));
  });

  it('rejects profile renames to an existing label', async () => {
    const profile = new MissingsProfilesDto();
    profile.label = 'Duplicate';
    setValidMissings(profile);

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
        id: 'mci', label: 'missing coding impossible', description: '', code: -97, score: null
      },
      {
        id: 'mir', label: 'missing invalid response', description: '', code: -98, score: 0
      },
      {
        id: 'mbi_mbo', label: 'mbi / mbo', description: '', code: -99, score: 0
      },
      {
        id: 'mnr', label: 'missing not reached', description: '', code: -96, score: null
      },
      {
        id: 'mbd', label: 'missing by design', description: '', code: -94, score: null
      }
    ]);
    repo.findOne.mockResolvedValue({
      id: profile.id,
      label: profile.label,
      missings: profile.missings
    });

    await expect(service.resolveMissingsProfileId(1, undefined)).resolves.toBe(7);
    await expect(service.getDefaultNegativeMissingCodes(1)).resolves.toEqual(new Set([-94, -96, -97, -98, -99]));
    await expect(service.getNegativeMissingCodesForProfileOrDefault(1, 0)).resolves.toEqual(new Set([-94, -96, -97, -98, -99]));
  });

  it('derives valid negative codes from all configured workspace profiles', async () => {
    const defaultProfile = new MissingsProfilesDto();
    defaultProfile.id = 7;
    defaultProfile.label = 'IQB-Standard';
    defaultProfile.setMissings([
      {
        id: 'mir', label: 'MIR', description: '', code: -98, score: 0
      },
      {
        id: 'mci', label: 'MCI', description: '', code: -97, score: null
      }
    ]);
    const customProfile = new MissingsProfilesDto();
    customProfile.id = 8;
    customProfile.label = 'Custom';
    customProfile.setMissings([
      {
        id: 'mir', label: 'MIR', description: '', code: -18, score: 0
      },
      {
        id: 'mci', label: 'MCI', description: '', code: -17, score: null
      }
    ]);
    repo.findOne.mockResolvedValue({
      id: defaultProfile.id,
      workspace_id: 1,
      label: defaultProfile.label,
      missings: defaultProfile.missings
    });
    repo.find.mockResolvedValue([{
      id: customProfile.id,
      workspace_id: 1,
      label: customProfile.label,
      missings: customProfile.missings
    }]);

    await expect(service.getWorkspaceNegativeMissingCodes(1))
      .resolves.toEqual(new Set([-98, -97, -99, -96, -94, -18, -17]));
    expect(repo.find).toHaveBeenCalledWith({ where: { workspace_id: 1 } });
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

  it('resolves profile missing values with explicit null scores', async () => {
    const profile = new MissingsProfilesDto();
    profile.id = 8;
    profile.label = 'NA profile';
    profile.missings = JSON.stringify([
      {
        id: 'mci', label: 'missing coding impossible', description: '', code: -97, score: null
      }
    ]);
    repo.findOne
      .mockResolvedValueOnce({ id: profile.id, label: profile.label, missings: profile.missings })
      .mockResolvedValueOnce({ id: profile.id, label: profile.label, missings: profile.missings });

    await expect(service.getMissingByIdForProfileOrDefault(1, 8, 'mci')).resolves.toEqual({
      id: 'mci',
      label: 'missing coding impossible',
      code: -97,
      score: null
    });
  });

  it('rejects unknown explicit profile ids', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.resolveMissingsProfileId(1, 99)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks updates and deletes for referenced profiles', async () => {
    const profile = new MissingsProfilesDto();
    profile.label = 'Used';
    setValidMissings(profile);
    repo.findOne.mockResolvedValue({
      id: 5, workspace_id: 1, label: 'Used', missings: profile.missings
    });
    codingJobRepository.count.mockResolvedValue(1);

    await expect(service.updateMissingsProfile(1, 'Used', profile)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteMissingsProfile(1, 'Used')).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('blocks updates and deletes for the default profile when legacy jobs use it implicitly', async () => {
    const profile = new MissingsProfilesDto();
    profile.label = 'IQB-Standard';
    setValidMissings(profile);
    repo.findOne.mockResolvedValue({
      id: 7, workspace_id: 1, label: 'IQB-Standard', missings: profile.missings
    });
    codingJobRepository.count.mockImplementation(async ({ where }) => (Array.isArray(where) ? 1 : 0));

    await expect(service.updateMissingsProfile(1, 'IQB-Standard', profile)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteMissingsProfile(1, 'IQB-Standard')).rejects.toBeInstanceOf(BadRequestException);

    expect(codingJobRepository.count).toHaveBeenCalledWith({
      where: expect.arrayContaining([
        { workspace_id: 1, missings_profile_id: 7 },
        expect.objectContaining({ workspace_id: 1, missings_profile_id: expect.any(Object) })
      ])
    });
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
