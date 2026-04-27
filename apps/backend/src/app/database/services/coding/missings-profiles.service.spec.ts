import { MissingsProfilesService } from './missings-profiles.service';
import { MissingsProfilesDto } from '../../../../../../../api-dto/coding/missings-profiles.dto';

const createRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(value => Promise.resolve(value)),
  delete: jest.fn()
});

describe('MissingsProfilesService', () => {
  let repo: ReturnType<typeof createRepo>;
  let service: MissingsProfilesService;

  beforeEach(() => {
    repo = createRepo();
    service = new MissingsProfilesService(repo as never);
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; error: jest.Mock } }).logger, 'log').mockImplementation(jest.fn());
    jest.spyOn((service as unknown as { logger: { log: jest.Mock; error: jest.Mock } }).logger, 'error').mockImplementation(jest.fn());
  });

  it('returns existing profiles and creates defaults for empty repositories', async () => {
    repo.find
      .mockResolvedValueOnce([{ id: 1, label: 'Custom' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 2, label: 'IQB-Standard' }]);
    repo.findOne.mockResolvedValue(null);

    await expect(service.getMissingsProfiles(1)).resolves.toEqual([{ id: 1, label: 'Custom' }]);
    await expect(service.getMissingsProfiles(1)).resolves.toEqual([{ id: 2, label: 'IQB-Standard' }]);
    expect(repo.save).toHaveBeenCalled();
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
    profile.setMissings([{ id: 'x', label: 'X', description: 'X', code: -1 }]);

    repo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ label: 'Old', missings: [] })
      .mockResolvedValueOnce({ label: 'Duplicate' });
    repo.delete.mockResolvedValueOnce({ affected: 1 }).mockResolvedValueOnce({ affected: 0 });

    await expect(service.createMissingsProfile(1, profile)).resolves.toBe(profile);
    await expect(service.updateMissingsProfile(1, 'Old', profile)).resolves.toBe(profile);
    await expect(service.createMissingsProfile(1, profile)).resolves.toBeNull();
    await expect(service.deleteMissingsProfile(1, 'Profile')).resolves.toBe(true);
    await expect(service.deleteMissingsProfile(1, 'Profile')).resolves.toBe(false);
  });
});
