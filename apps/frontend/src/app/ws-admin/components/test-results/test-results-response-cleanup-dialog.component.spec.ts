import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject, of } from 'rxjs';
import { TestResultsResponseCleanupDialogComponent } from './test-results-response-cleanup-dialog.component';
import { TestResultBackendService } from '../../../shared/services/test-result/test-result-backend.service';
import { FileBackendService } from '../../../shared/services/file/file-backend.service';

describe('TestResultsResponseCleanupDialogComponent zoneless rendering', () => {
  let fixture: ComponentFixture<TestResultsResponseCleanupDialogComponent>;
  let response: Subject<{ units: string[] }>;

  beforeEach(async () => {
    response = new Subject<{ units: string[] }>();
    await TestBed.configureTestingModule({
      imports: [TestResultsResponseCleanupDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 1 } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: TestResultBackendService, useValue: { getExportOptions: () => response } },
        { provide: FileBackendService, useValue: { getUnitVariables: () => of([]) } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(TestResultsResponseCleanupDialogComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-state')).toBeTruthy();
  });

  it('renders the choices after the server responds', async () => {
    response.next({ units: ['UNIT_1'] });
    response.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-state')).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-select')).toBeTruthy();
    expect(fixture.componentInstance.availableUnits).toEqual(['UNIT_1']);
  });

  it('renders delayed failures and keeps the preview disabled', async () => {
    response.error(new Error('Unavailable'));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-state')).toBeNull();
    expect(fixture.nativeElement.querySelector('.message-state').textContent).toContain('konnten nicht geladen werden');
    expect(fixture.nativeElement.querySelector('mat-select')).toBeNull();
    expect(fixture.nativeElement.querySelector('button:last-child').disabled).toBe(true);
  });
});
