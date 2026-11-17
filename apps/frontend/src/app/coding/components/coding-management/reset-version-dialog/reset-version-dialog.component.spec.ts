import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { GermanTranslationsTestingModule } from '../../../../../testing/german-translations';
import {
  ResetVersionDialogComponent,
  ResetVersionDialogData
} from './reset-version-dialog.component';
import { ResetFilterDetailsDialogComponent } from './reset-filter-details-dialog.component';

describe('ResetVersionDialogComponent', () => {
  const dialogRefMock = {
    close: jest.fn()
  };
  const dialogMock = { open: jest.fn() };

  async function setup(data: ResetVersionDialogData): Promise<{
    component: ResetVersionDialogComponent;
    fixture: ComponentFixture<ResetVersionDialogComponent>;
  }> {
    TestBed.configureTestingModule({
      imports: [
        ResetVersionDialogComponent,
        GermanTranslationsTestingModule
      ],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: data }
      ]
    });
    TestBed.overrideProvider(MatDialog, { useValue: dialogMock });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(ResetVersionDialogComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    return { component, fixture };
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('explains that v1 reset cascades while preserving coding jobs', async () => {
    const { component, fixture } = await setup({
      version: 'v1',
      versionLabel: 'coding-management.statistics.first-autocode-run',
      cascadeVersions: ['v2', 'v3']
    });

    const text = fixture.nativeElement.textContent;

    expect(component.resultImpactKey).toBe('coding-management.reset-dialog.result-impact.v1');
    expect(text).toContain('Der erste Autocoder-Lauf wird zurückgesetzt.');
    expect(text).toContain('Bestehende Kodierjobs, Zuweisungen und Joblisten werden dadurch nicht gelöscht.');
    expect(text).toContain('Zusätzlich werden die manuelle Kodierung und der 2. Autocoder-Lauf im gewählten Bereich zurückgesetzt.');
    expect(text).toContain('status_v1');
    expect(text).toContain('code_v1');
    expect(text).toContain('score_v1');
    expect(text).toContain('status_v2');
    expect(text).toContain('code_v2');
    expect(text).toContain('score_v2');
    expect(text).toContain('status_v3');
    expect(text).toContain('code_v3');
    expect(text).toContain('score_v3');
  });

  it('explains that v3 reset has no cascade', async () => {
    const { component, fixture } = await setup({
      version: 'v3',
      versionLabel: 'coding-management.statistics.second-autocode-run',
      cascadeVersions: []
    });

    const text = fixture.nativeElement.textContent;

    expect(component.resultImpactKey).toBe('coding-management.reset-dialog.result-impact.v3');
    expect(text).toContain('Nur der zweite Autocoder-Lauf wird zurückgesetzt.');
    expect(text).not.toContain('Folgende Versionen werden ebenfalls gelöscht');
    expect(text).toContain('status_v3');
    expect(text).toContain('code_v3');
    expect(text).toContain('score_v3');
  });

  it('confirms the global scope with empty filters', async () => {
    const { component, fixture } = await setup({
      version: 'v2',
      versionLabel: 'coding-management.statistics.manual-coding-run',
      cascadeVersions: ['v3']
    });

    component.onConfirm();

    expect(fixture.nativeElement.querySelector('.confirmation-footer .scope-summary').textContent).toContain('gesamter Arbeitsbereich');
    expect(fixture.nativeElement.querySelector('.confirmation-footer .confirmation-cascade').textContent).toContain('Die manuelle Kodierung wird zurückgesetzt. Zusätzlich: 2. Autocoder-Lauf.');
    expect(fixture.nativeElement.querySelector('.confirm-button').textContent).toContain('Gesamten Arbeitsbereich zurücksetzen');
    expect(dialogRefMock.close).toHaveBeenCalledWith({ unitFilters: [], variableFilters: [] });
  });

  async function selectScope(fixture: ComponentFixture<ResetVersionDialogComponent>, scope: string): Promise<void> {
    fixture.nativeElement.querySelector(`input[value="${scope}"]`).click();
    await fixture.whenStable();
  }

  async function enterFilter(fixture: ComponentFixture<ResetVersionDialogComponent>, kind: string, value: string): Promise<void> {
    const input: HTMLTextAreaElement = fixture.nativeElement.querySelector(`[data-cy="reset-${kind}-filters"]`);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  it('blocks an empty filtered reset, including separators and whitespace', async () => {
    const { component, fixture } = await setup({ version: 'v1', versionLabel: '' });
    await selectScope(fixture, 'filtered');

    expect(fixture.nativeElement.querySelector('.confirm-button').disabled).toBe(true);
    await enterFilter(fixture, 'unit', ' , ;\n ');
    await enterFilter(fixture, 'variable', ' ; ,\r\n');
    component.onConfirm();

    expect(fixture.nativeElement.querySelector('.scope-summary').textContent).toContain('mindestens einen Unit-Namen');
    expect(fixture.nativeElement.querySelector('.confirm-button').disabled).toBe(true);
    expect(dialogRefMock.close).not.toHaveBeenCalled();
  });

  it('confirms DHB003 only and shows that all its variables are included', async () => {
    const { fixture } = await setup({ version: 'v1', versionLabel: '', cascadeVersions: ['v2', 'v3'] });
    await selectScope(fixture, 'filtered');
    await enterFilter(fixture, 'unit', ' DHB003; DHB003\n');

    const summary = fixture.nativeElement.querySelector('.scope-summary').textContent;
    expect(summary).toContain('Gefilterter Reset');
    expect(summary).toContain('Units: DHB003');
    expect(summary).toContain('alle Variablen der betroffenen Units');
    expect(summary).toContain('Der 1. Autocoder-Lauf wird zurückgesetzt. Zusätzlich: manuelle Kodierung und 2. Autocoder-Lauf.');
    expect(fixture.nativeElement.querySelector('.filter-fields').textContent).toContain('Kaskade gilt nur für den angegebenen Bereich');
    expect(fixture.nativeElement.querySelector('.confirm-button').textContent).toContain('Gefilterten Bereich zurücksetzen');
    fixture.nativeElement.querySelector('.confirm-button').click();

    expect(dialogRefMock.close).toHaveBeenCalledWith({ unitFilters: ['DHB003'], variableFilters: [] });
  });

  it('normalizes both filters without changing names, case or embedded spaces', async () => {
    const { component, fixture } = await setup({ version: 'v2', versionLabel: '' });
    await selectScope(fixture, 'filtered');
    await enterFilter(fixture, 'unit', ' DHB003,Unit with spaces;DHB003\nOtherUnit');
    await enterFilter(fixture, 'variable', ' V1; V2\nV1, v1 ');

    expect(fixture.nativeElement.querySelector('.scope-summary').textContent).toContain('Variablen: V1, V2, v1');
    component.onConfirm();

    expect(dialogRefMock.close).toHaveBeenCalledWith({
      unitFilters: ['DHB003', 'Unit with spaces', 'OtherUnit'], variableFilters: ['V1', 'V2', 'v1']
    });
  });

  it('allows a variable-only scope and makes the inclusion of all units clear', async () => {
    const { component, fixture } = await setup({ version: 'v3', versionLabel: '' });
    await selectScope(fixture, 'filtered');
    await enterFilter(fixture, 'variable', 'V1');

    expect(fixture.nativeElement.querySelector('.scope-summary').textContent).toContain('Units: alle Units im Arbeitsbereich');
    expect(fixture.nativeElement.querySelector('.confirmation-footer .confirmation-cascade').textContent).toContain('Nur der 2. Autocoder-Lauf wird zurückgesetzt.');
    component.onConfirm();

    expect(dialogRefMock.close).toHaveBeenCalledWith({ unitFilters: [], variableFilters: ['V1'] });
  });

  it('discards entered filters when confirming a global reset', async () => {
    const { component, fixture } = await setup({ version: 'v1', versionLabel: '' });
    await selectScope(fixture, 'filtered');
    await enterFilter(fixture, 'unit', 'DHB003');
    await enterFilter(fixture, 'variable', 'V1');
    await selectScope(fixture, 'global');
    component.onConfirm();

    expect(dialogRefMock.close).toHaveBeenCalledWith({ unitFilters: [], variableFilters: [] });
  });

  it('lets users inspect every normalized filter in a long selection without confirming a reset', async () => {
    const { fixture } = await setup({ version: 'v1', versionLabel: '' });
    await selectScope(fixture, 'filtered');
    await enterFilter(fixture, 'unit', 'DHB001; DHB002; DHB003; DHB004; DHB001');
    await enterFilter(fixture, 'variable', 'V1; V2');

    const summary = fixture.nativeElement.querySelector('.scope-summary');
    expect(summary.textContent).toContain('Units: 4 ausgewählt');
    expect(summary.textContent).toContain('Variablen: 2 ausgewählt');
    summary.querySelector('.filter-details-button').click();

    expect(dialogMock.open).toHaveBeenCalledWith(ResetFilterDetailsDialogComponent, expect.objectContaining({
      data: { unitFilters: ['DHB001', 'DHB002', 'DHB003', 'DHB004'], variableFilters: ['V1', 'V2'] }
    }));
    expect(dialogRefMock.close).not.toHaveBeenCalled();
  });

  it('also offers full details for one long name and still makes all variables explicit', async () => {
    const { fixture } = await setup({ version: 'v1', versionLabel: '' });
    await selectScope(fixture, 'filtered');
    await enterFilter(fixture, 'unit', `DHB003_${'long-name'.repeat(8)}`);

    expect(fixture.nativeElement.querySelector('.scope-summary').textContent).toContain('Units: 1 ausgewählt');
    expect(fixture.nativeElement.querySelector('.scope-summary').textContent).toContain('alle Variablen der betroffenen Units');
    expect(fixture.nativeElement.querySelector('.filter-details-button')).not.toBeNull();
  });

  it('cancels without returning a reset request', async () => {
    const { fixture } = await setup({ version: 'v1', versionLabel: '' });
    fixture.nativeElement.querySelector('.cancel-button').click();

    expect(dialogRefMock.close).toHaveBeenCalledWith();
  });
});
