import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { JobInfo } from '../../services/test-person-coding.service';
import { TestPersonCodingJobResultDialogComponent } from './test-person-coding-job-result-dialog.component';

describe('TestPersonCodingJobResultDialogComponent', () => {
  let fixture: ComponentFixture<TestPersonCodingJobResultDialogComponent>;

  beforeEach(async () => {
    const job: JobInfo = {
      jobId: 'warning-job',
      status: 'completed',
      progress: 100,
      result: {
        totalResponses: 1,
        statusCounts: { CODED: 1 },
        warnings: ['Cache finalization remained incomplete']
      }
    };

    await TestBed.configureTestingModule({
      imports: [
        TestPersonCodingJobResultDialogComponent,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: MAT_DIALOG_DATA, useValue: { job } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(
      TestPersonCodingJobResultDialogComponent
    );
    fixture.detectChanges();
  });

  it('renders persisted job warnings', () => {
    expect(fixture.componentInstance.warnings).toEqual([
      'Cache finalization remained incomplete'
    ]);
    expect(
      fixture.nativeElement.querySelector('.warnings')?.textContent
    ).toContain('Cache finalization remained incomplete');
  });
});
