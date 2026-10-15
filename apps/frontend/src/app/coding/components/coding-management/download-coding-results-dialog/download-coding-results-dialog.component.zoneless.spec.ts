import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { DownloadCodingResultsDialogComponent } from './download-coding-results-dialog.component';
import { MissingsProfileService } from '../../../services/missings-profile.service';

describe('Coding results download with delayed responses without Zone.js', () => {
  let fixture: ComponentFixture<DownloadCodingResultsDialogComponent>;
  let profiles: Subject<Array<{ id: number; label: string }>>;
  let retryProfiles: Subject<Array<{ id: number; label: string }>>;
  let service: { getExportMissingsProfilesOrThrow: jest.Mock };
  const dialogRef = { close: jest.fn() };

  beforeEach(async () => {
    profiles = new Subject();
    retryProfiles = new Subject();
    dialogRef.close.mockClear();
    service = {
      getExportMissingsProfilesOrThrow: jest.fn()
        .mockReturnValueOnce(profiles)
        .mockReturnValueOnce(retryProfiles)
    };
    await TestBed.configureTestingModule({
      imports: [DownloadCodingResultsDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 5, currentVersion: 'v2' } },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MissingsProfileService, useValue: service }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(DownloadCodingResultsDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    // Let Material's initial rendering notifications finish before the response.
    await new Promise(resolve => { setTimeout(resolve, 150); });
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  const element = (): HTMLElement => fixture.nativeElement;
  const downloadButton = (): HTMLButtonElement => (
    element().querySelector('.dialog-actions button:last-of-type') as HTMLButtonElement
  );
  const profileSelect = (): HTMLElement => (
    element().querySelector('.profile-select mat-select') as HTMLElement
  );

  it('replaces loading with the default profile and enables downloading after success', async () => {
    expect(element().querySelector('.profile-hint')).not.toBeNull();
    expect(profileSelect().getAttribute('aria-disabled')).toBe('true');
    expect(downloadButton().disabled).toBe(true);

    profiles.next([{ id: 11, label: 'Other profile' }, { id: 4, label: 'IQB-Standard' }]);
    profiles.complete();
    await fixture.whenStable();

    expect(element().querySelector('.profile-hint')).toBeNull();
    expect(element().querySelector('.profile-error')).toBeNull();
    expect(profileSelect().getAttribute('aria-disabled')).toBe('false');
    expect(profileSelect().textContent).toContain('IQB-Standard');
    expect(downloadButton().disabled).toBe(false);

    downloadButton().click();
    await fixture.whenStable();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
      version: 'v2', missingsProfileId: 4
    }));
  });

  it('shows the empty result and keeps downloading disabled after a delayed empty response', async () => {
    profiles.next([]);
    profiles.complete();
    await fixture.whenStable();

    expect(element().querySelector('.profile-hint')).toBeNull();
    expect(element().querySelector('.profile-error')?.textContent)
      .toContain('coding-management.download-dialog.no-missings-profiles');
    expect(profileSelect().getAttribute('aria-disabled')).toBe('false');
    expect(downloadButton().disabled).toBe(true);
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('shows a delayed error and retries when the user selects another version', async () => {
    profiles.error(new Error('Profiles unavailable'));
    await fixture.whenStable();

    expect(element().querySelector('.profile-hint')).toBeNull();
    expect(element().querySelector('.profile-error')?.textContent)
      .toContain('coding-management.download-dialog.missings-profiles-error');
    expect(downloadButton().disabled).toBe(true);

    const nextVersion = element().querySelector('.version-card input[value="v3"]') as HTMLInputElement;
    nextVersion.click();
    await fixture.whenStable();
    expect(service.getExportMissingsProfilesOrThrow).toHaveBeenNthCalledWith(2, 5);
    expect(element().querySelector('.profile-error')).toBeNull();
    expect(element().querySelector('.profile-hint')).not.toBeNull();
    expect(profileSelect().getAttribute('aria-disabled')).toBe('true');
    expect(downloadButton().disabled).toBe(true);

    await new Promise(resolve => { setTimeout(resolve, 150); });
    await fixture.whenStable();
    retryProfiles.next([{ id: 12, label: 'Recovered profile' }]);
    retryProfiles.complete();
    await fixture.whenStable();

    expect(element().querySelector('.profile-hint')).toBeNull();
    expect(element().querySelector('.profile-error')).toBeNull();
    expect(profileSelect().textContent).toContain('Recovered profile');
    expect(downloadButton().disabled).toBe(false);

    downloadButton().click();
    await fixture.whenStable();
    expect(dialogRef.close).toHaveBeenCalledWith(expect.objectContaining({
      version: 'v3', missingsProfileId: 12
    }));
  });
});
