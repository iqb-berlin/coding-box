import { of } from 'rxjs';
import { EditMissingsProfilesDialogComponent } from './edit-missings-profiles-dialog.component';
import { MissingDto, MissingsProfilesDto } from '../../../../../../../api-dto/coding/missings-profiles.dto';

describe('EditMissingsProfilesDialogComponent', () => {
  const createValidMissings = (): MissingDto[] => [
    {
      id: 'mir',
      label: 'missing invalid response',
      description: '',
      code: -98,
      score: 0
    },
    {
      id: 'mci',
      label: 'missing coding impossible',
      description: '',
      code: -97,
      score: null
    }
  ];

  const createComponent = (
    missingsProfileService: Partial<{
      createMissingsProfile: jest.Mock;
      updateMissingsProfile: jest.Mock;
      getMissingsProfiles: jest.Mock;
      getMissingsProfileDetails: jest.Mock;
    }> = {},
    snackBar = { open: jest.fn() }
  ) => new EditMissingsProfilesDialogComponent(
    { close: jest.fn() } as never,
    { workspaceId: 1 },
    missingsProfileService as never,
    {} as never,
    snackBar as never,
    { instant: jest.fn(key => key) } as never
  );

  it('validates missing entries like the backend', () => {
    const component = createComponent();

    expect(component.isProfileValid(createValidMissings())).toBe(true);

    expect(component.isProfileValid([createValidMissings()[0]])).toBe(false);

    expect(component.isProfileValid([
      ...createValidMissings(),
      {
        id: 'extra',
        label: 'extra',
        description: '',
        code: 998,
        score: 0
      }
    ])).toBe(false);

    expect(component.isProfileValid([
      ...createValidMissings(),
      {
        id: 'extra',
        label: 'extra',
        description: '',
        code: -1.5,
        score: 0
      }
    ])).toBe(false);

    expect(component.isProfileValid([
      ...createValidMissings(),
      {
        id: 'mir',
        label: 'duplicate id',
        description: '',
        code: -96,
        score: 0
      }
    ])).toBe(false);

    expect(component.isProfileValid([
      ...createValidMissings(),
      {
        id: 'extra',
        label: 'duplicate code',
        description: '',
        code: -98,
        score: 0
      }
    ])).toBe(false);

    expect(component.isProfileValid([
      ...createValidMissings(),
      {
        ...createValidMissings()[0], id: 'extra', code: -96, score: undefined
      } as never
    ])).toBe(false);

    expect(component.isProfileValid([
      ...createValidMissings(),
      {
        ...createValidMissings()[0], id: 'extra', code: -96, score: ''
      } as never
    ])).toBe(false);

    expect(component.isProfileValid([
      ...createValidMissings(),
      {
        ...createValidMissings()[0], id: 'extra', code: -96, score: false
      } as never
    ])).toBe(false);

    expect(component.isProfileValid([
      ...createValidMissings(),
      {
        ...createValidMissings()[0], id: 'extra', code: -96, score: null
      } as never
    ])).toBe(true);
  });

  it('rejects malformed missing ids and labels without throwing', () => {
    const component = createComponent();

    expect(() => component.isProfileValid([
      ...createValidMissings(),
      {
        id: 123,
        label: 'invalid id type',
        description: '',
        code: -96,
        score: 0
      } as never
    ])).not.toThrow();

    expect(component.isProfileValid([
      ...createValidMissings(),
      {
        id: 123,
        label: 'invalid id type',
        description: '',
        code: -96,
        score: 0
      } as never
    ])).toBe(false);

    expect(component.isProfileValid([
      ...createValidMissings(),
      {
        id: 'invalid-label-type',
        label: { text: 'label' },
        description: '',
        code: -96,
        score: 0
      } as never
    ])).toBe(false);
  });

  it('starts new profiles with the required missing rows', () => {
    const component = createComponent();

    component.createProfile();

    expect(component.editMissings).toEqual(createValidMissings());
  });

  it('adds new missing rows with an editable score value', () => {
    const component = createComponent();
    component.createProfile();

    component.addMissing();

    expect(component.editMissings[2]).toEqual(expect.objectContaining({
      code: -99,
      score: 0
    }));
  });

  it('normalizes explicit NA scores for storage and display', () => {
    const component = createComponent();
    const missings = createValidMissings();

    expect(component.normalizeMissingsForStorage(missings)[1]).toEqual(expect.objectContaining({
      code: -97,
      score: null
    }));
    expect(component.getScoreDisplay(null)).toBe('NA');
  });

  it('treats a null update response as a failed save', () => {
    const snackBar = { open: jest.fn() };
    const missingsProfileService = {
      updateMissingsProfile: jest.fn(() => of(null))
    };
    const component = createComponent(missingsProfileService, snackBar);
    const selectedProfile = new MissingsProfilesDto();
    selectedProfile.id = 7;
    selectedProfile.label = 'Existing';
    selectedProfile.setMissings(createValidMissings());
    component.missingsProfiles = [{ id: 7, label: 'Existing' }];
    component.selectedProfile = selectedProfile;
    component.editMissings = createValidMissings();
    component.editMode = true;

    component.saveProfile();

    expect(missingsProfileService.updateMissingsProfile).toHaveBeenCalledWith(1, 'Existing', selectedProfile);
    expect(component.saving).toBe(false);
    expect(component.editMode).toBe(true);
    expect(snackBar.open).toHaveBeenCalledWith('workspace.error-updating-missings-profile', 'close', { duration: 3000 });
  });

  it('treats a null create response as a failed save', () => {
    const snackBar = { open: jest.fn() };
    const missingsProfileService = {
      createMissingsProfile: jest.fn(() => of(null))
    };
    const component = createComponent(missingsProfileService, snackBar);
    const selectedProfile = new MissingsProfilesDto();
    selectedProfile.label = 'New';
    selectedProfile.setMissings(createValidMissings());
    component.selectedProfile = selectedProfile;
    component.editMissings = createValidMissings();
    component.editMode = true;

    component.saveProfile();

    expect(missingsProfileService.createMissingsProfile).toHaveBeenCalledWith(1, selectedProfile);
    expect(component.saving).toBe(false);
    expect(component.editMode).toBe(true);
    expect(snackBar.open).toHaveBeenCalledWith('workspace.error-creating-missings-profile', 'close', { duration: 3000 });
  });

  it('creates instead of updating when a new profile reuses an existing label', () => {
    const snackBar = { open: jest.fn() };
    const missingsProfileService = {
      createMissingsProfile: jest.fn(() => of(null)),
      updateMissingsProfile: jest.fn(() => of(null))
    };
    const component = createComponent(missingsProfileService, snackBar);
    const selectedProfile = new MissingsProfilesDto();
    selectedProfile.label = 'Existing';
    selectedProfile.setMissings(createValidMissings());
    component.missingsProfiles = [{ id: 7, label: 'Existing' }];
    component.selectedProfile = selectedProfile;
    component.editMissings = createValidMissings();
    component.editMode = true;

    component.saveProfile();

    expect(missingsProfileService.createMissingsProfile).toHaveBeenCalledWith(1, selectedProfile);
    expect(missingsProfileService.updateMissingsProfile).not.toHaveBeenCalled();
    expect(component.saving).toBe(false);
    expect(component.editMode).toBe(true);
    expect(snackBar.open).toHaveBeenCalledWith('workspace.error-creating-missings-profile', 'close', { duration: 3000 });
  });
});
