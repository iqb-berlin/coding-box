import { UnitSearchDialogComponent } from './unit-search-dialog.component';

describe('UnitSearchDialogComponent', () => {
  function createComponent() {
    const router = {
      createUrlTree: jest.fn(() => ['url-tree']),
      serializeUrl: jest.fn(() => '/replay/login@code@group@BOOKLET_A/UNIT_1/0/0?workspaceId=123')
    };
    const appService = {
      selectedWorkspaceId: 123
    };

    const component = new UnitSearchDialogComponent(
      {} as never,
      { title: 'Unit search' },
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      appService as never,
      router as never,
      {} as never,
      {} as never
    );

    return { component, router };
  }

  it('should open replay with a clean hash route URL and without auth token', () => {
    const { component, router } = createComponent();
    const windowOpenSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    component.replayUnit({
      unitId: 1,
      unitName: 'UNIT_1',
      unitAlias: 'UNIT_1',
      bookletId: 1,
      bookletName: 'BOOKLET_A',
      personId: 1,
      personLogin: 'login',
      personCode: 'code',
      personGroup: 'group',
      tags: [],
      responses: []
    } as never);

    expect(router.createUrlTree).toHaveBeenCalledWith(
      ['replay/login@code@group@BOOKLET_A/UNIT_1/0/0'],
      { queryParams: { workspaceId: 123 } }
    );
    expect(windowOpenSpy).toHaveBeenCalledWith(expect.any(String), '_blank');
    const openedUrl = windowOpenSpy.mock.calls[0][0] as string;
    expect(openedUrl).toContain('/#/replay/');
    expect(openedUrl).toContain('workspaceId=123');
    expect(openedUrl).not.toContain('#//replay');
    expect(openedUrl).not.toContain('auth=');

    windowOpenSpy.mockRestore();
  });
});
