import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

import { CodingJobResultDialogComponent } from './coding-job-result-dialog.component';

describe('CodingJobResultDialogComponent', () => {
  let component: CodingJobResultDialogComponent;
  let fixture: ComponentFixture<CodingJobResultDialogComponent>;

  const mockDialogRef = {
    close: jest.fn()
  };

  const mockDialogData = {
    codingJob: { id: 1, name: 'Test Job' },
    workspaceId: 123
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodingJobResultDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData }
      ]
    })
      .compileComponents();

    fixture = TestBed.createComponent(CodingJobResultDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
