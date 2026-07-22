import { of, Subject } from 'rxjs';
import {
  DownloadCodingResultsDialogComponent,
  DownloadCodingResultsDialogData
} from './download-coding-results-dialog.component';

describe('DownloadCodingResultsDialogComponent', () => {
  const createComponent = (
    currentVersion: 'v1' | 'v2' | 'v3',
    profiles = of([{ id: 4, label: 'IQB-Standard' }])
  ) => {
    const dialogRef = { close: jest.fn() };
    const missingsProfileService = {
      getExportMissingsProfilesOrThrow: jest.fn().mockReturnValue(profiles)
    };
    const data: DownloadCodingResultsDialogData = {
      workspaceId: 5,
      currentVersion
    };
    const component = new DownloadCodingResultsDialogComponent(
      dialogRef as never,
      data,
      missingsProfileService as never
    );

    return { component, dialogRef, missingsProfileService };
  };

  it.each(['v2', 'v3'] as const)(
    'does not load profiles or block an initial %s download',
    version => {
      const { component, missingsProfileService } = createComponent(version);

      component.ngOnInit();

      expect(missingsProfileService.getExportMissingsProfilesOrThrow)
        .not.toHaveBeenCalled();
      expect(component.isDownloadDisabled).toBe(false);
    }
  );

  it('loads profiles lazily when v1 is selected', () => {
    const { component, missingsProfileService } = createComponent('v2');
    component.ngOnInit();

    component.selectedVersion = 'v1';
    component.onVersionChange();

    expect(missingsProfileService.getExportMissingsProfilesOrThrow)
      .toHaveBeenCalledWith(5);
    expect(component.selectedMissingsProfileId).toBe(4);
    expect(component.isDownloadDisabled).toBe(false);
  });

  it('does not block v2 while a v1 profile request is pending', () => {
    const profiles = new Subject<Array<{ id: number; label: string }>>();
    const { component } = createComponent('v1', profiles);
    component.ngOnInit();

    expect(component.isLoadingMissingsProfiles).toBe(true);
    expect(component.isDownloadDisabled).toBe(true);

    component.selectedVersion = 'v2';
    component.onVersionChange();

    expect(component.isDownloadDisabled).toBe(false);
  });

  it('submits the selected profile only for v1', () => {
    const { component, dialogRef } = createComponent('v1');
    component.ngOnInit();

    component.onDownload();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 'v1',
        missingsProfileId: 4
      })
    );
  });
});
