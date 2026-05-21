import { MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { JobDefinitionRefreshPreviewDto } from '../../../../../../../api-dto/coding/job-refresh.dto';
import { JobDefinitionRefreshDialogComponent } from './job-definition-refresh-dialog.component';

describe('JobDefinitionRefreshDialogComponent', () => {
  const createComponent = (previewOverride?: Partial<JobDefinitionRefreshPreviewDto>) => {
    const preview: JobDefinitionRefreshPreviewDto = {
      jobDefinitionId: 42,
      existingJobsCount: 5,
      staleJobsCount: 2,
      existingCases: 10,
      plannedCases: 12,
      retainedCases: 9,
      addedCases: 3,
      removedCases: 1,
      addedCodingTasks: 4,
      removedCodingTasks: 2,
      canApply: true,
      ...previewOverride
    };
    const dialogRef = {
      close: jest.fn()
    } as unknown as MatDialogRef<JobDefinitionRefreshDialogComponent, boolean>;
    const translateService = {
      instant: jest.fn((key: string) => key)
    } as unknown as TranslateService;

    return new JobDefinitionRefreshDialogComponent(
      dialogRef,
      { definitionId: 42, preview },
      translateService
    );
  };

  it('labels freshness count as stale jobs instead of replaceable jobs', () => {
    const component = createComponent();

    expect(component.getJobStats()).toEqual([
      {
        labelKey: 'coding-job-definitions.refresh-dialog.stats.existing-jobs',
        value: 5,
        tone: 'default'
      },
      {
        labelKey: 'coding-job-definitions.refresh-dialog.stats.stale-jobs',
        value: 2,
        tone: 'warning'
      }
    ]);
  });
});
