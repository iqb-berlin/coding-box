import { EditMissingsProfilesDialogComponent } from './edit-missings-profiles-dialog.component';

describe('EditMissingsProfilesDialogComponent', () => {
  const createComponent = () => new EditMissingsProfilesDialogComponent(
    { close: jest.fn() } as never,
    { workspaceId: 1 },
    {} as never,
    {} as never,
    { open: jest.fn() } as never,
    { instant: jest.fn(key => key) } as never
  );

  it('requires missing entries to define an explicit score', () => {
    const component = createComponent();

    expect(component.isProfileValid([
      {
        id: 'mir',
        label: 'missing invalid response',
        description: '',
        code: -98,
        score: 0
      }
    ])).toBe(true);

    expect(component.isProfileValid([
      {
        id: 'mir',
        label: 'missing invalid response',
        description: '',
        code: -98
      } as never
    ])).toBe(false);

    expect(component.isProfileValid([
      {
        id: 'mir',
        label: 'missing invalid response',
        description: '',
        code: -98,
        score: ''
      } as never
    ])).toBe(false);

    expect(component.isProfileValid([
      {
        id: 'mir',
        label: 'missing invalid response',
        description: '',
        code: -98,
        score: null
      } as never
    ])).toBe(false);

    expect(component.isProfileValid([
      {
        id: 'mir',
        label: 'missing invalid response',
        description: '',
        code: -98,
        score: false
      } as never
    ])).toBe(false);
  });

  it('adds new missing rows with an editable score value', () => {
    const component = createComponent();
    component.createProfile();

    component.addMissing();

    expect(component.editMissings[0]).toEqual(expect.objectContaining({
      code: 998,
      score: 0
    }));
  });
});
