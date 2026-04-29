import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  ResetVersionDialogComponent,
  ResetVersionDialogData
} from './reset-version-dialog.component';

describe('ResetVersionDialogComponent', () => {
  const dialogRefMock = {
    close: jest.fn()
  };

  async function setup(data: ResetVersionDialogData): Promise<{
    component: ResetVersionDialogComponent;
    fixture: ComponentFixture<ResetVersionDialogComponent>;
  }> {
    await TestBed.configureTestingModule({
      imports: [
        ResetVersionDialogComponent,
        TranslateModule.forRoot(),
        NoopAnimationsModule
      ],
      providers: [
        { provide: MatDialogRef, useValue: dialogRefMock },
        { provide: MAT_DIALOG_DATA, useValue: data }
      ]
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', {
      'coding-management': {
        'reset-dialog': {
          title: 'Kodierversion zurücksetzen',
          'warning-message': 'Warnung',
          'version-to-reset': 'Zu resettierende Version',
          'result-impact-title': 'Welche Ergebnisse werden zurückgesetzt?',
          'result-impact': {
            v1: 'Der erste Autocoder-Lauf wird zurückgesetzt.',
            v2: 'Die manuelle Kodierung wird zurückgesetzt.',
            v3: 'Nur der zweite Autocoder-Lauf wird zurückgesetzt.'
          },
          'technical-fields': 'Technisch geleert werden die Ergebnisfelder',
          'jobs-preserved-title': 'Was bleibt erhalten?',
          'jobs-preserved-text': 'Bestehende Kodierjobs, Zuweisungen und Joblisten werden dadurch nicht gelöscht.',
          'cascade-warning': 'Kaskade',
          'cascade-versions': 'Folgende Versionen werden ebenfalls gelöscht',
          'cascade-explanation': 'Kaskadenerklärung',
          'irreversible-warning': 'Irreversibel',
          'cancel-button': 'Abbrechen',
          'confirm-button': 'Ja, zurücksetzen'
        },
        statistics: {
          'first-autocode-run': '1 Autocoder Lauf',
          'second-autocode-run': '2 Autocoder Lauf',
          'manual-coding-run': 'Manuelle Kodierung'
        }
      }
    });
    translate.use('de');

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
    expect(text).toContain('Folgende Versionen werden ebenfalls gelöscht');
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

  it('closes with true when confirmed', async () => {
    const { component } = await setup({
      version: 'v2',
      versionLabel: 'coding-management.statistics.manual-coding-run',
      cascadeVersions: ['v3']
    });

    component.onConfirm();

    expect(dialogRefMock.close).toHaveBeenCalledWith(true);
  });
});
