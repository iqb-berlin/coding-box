import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { SERVER_ERROR_MESSAGE } from '../../../core/interceptors/app-http-error.class';
import { JournalService } from '../../../core/services/journal.service';
import { JournalComponent } from './journal.component';

describe('JournalComponent', () => {
  let fixture: ComponentFixture<JournalComponent>;
  let component: JournalComponent;
  let journalService: {
    getJournalEntries: jest.Mock;
    downloadJournalEntriesAsCsv: jest.Mock;
  };
  let appService: { selectedWorkspaceId: number };

  beforeEach(async () => {
    journalService = {
      getJournalEntries: jest.fn().mockReturnValue(of({
        data: [],
        total: 0,
        page: 1,
        limit: 20
      })),
      downloadJournalEntriesAsCsv: jest.fn()
    };
    appService = { selectedWorkspaceId: 5 };

    await TestBed.configureTestingModule({
      imports: [
        JournalComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: AppService, useValue: appService },
        { provide: JournalService, useValue: journalService },
        { provide: MatSnackBar, useValue: { open: jest.fn() } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(JournalComponent);
    component = fixture.componentInstance;
  });

  it('should show an inline load error instead of the empty state', () => {
    journalService.getJournalEntries.mockReturnValue(throwError(() => new HttpErrorResponse({
      error: { message: 'Internal server error' },
      headers: new HttpHeaders({ 'X-Request-Id': 'journal-request-1' }),
      status: 500,
      statusText: 'Internal Server Error'
    })));

    fixture.detectChanges();

    expect(component.loadError).toBe(true);
    expect(component.loadErrorMessage).toBe(SERVER_ERROR_MESSAGE);
    expect(component.loadErrorRequestId).toBe('journal-request-1');
    expect(component.journalEntries).toEqual([]);
    expect(component.totalEntries).toBe(0);
    expect(fixture.nativeElement.textContent).toContain('journal.load-error-title');
    expect(fixture.nativeElement.textContent).toContain(SERVER_ERROR_MESSAGE);
    expect(fixture.nativeElement.textContent).toContain('journal-request-1');
    expect(fixture.nativeElement.textContent).not.toContain('journal.no-entries');
    expect(journalService.getJournalEntries).toHaveBeenCalledWith(
      5,
      1,
      20,
      {},
      { suppressGlobalError: true }
    );
  });

  it('should clear the inline load error after retry succeeds', () => {
    journalService.getJournalEntries
      .mockReturnValueOnce(throwError(() => new Error('Load failed')))
      .mockReturnValueOnce(of({
        data: [{
          id: 1,
          workspaceId: 5,
          actorType: 'user',
          actorUserId: 10,
          eventType: 'workspace.export',
          entityType: 'workspace',
          entityId: '5',
          result: 'success',
          summary: 'Export gestartet',
          details: null,
          timestamp: '2026-05-18T10:42:00.000Z'
        }],
        total: 1,
        page: 1,
        limit: 20
      }));

    fixture.detectChanges();
    expect(component.loadError).toBe(true);

    component.loadJournalEntries();

    expect(component.loadError).toBe(false);
    expect(component.totalEntries).toBe(1);
  });

  it('should show a status-specific inline load error message', () => {
    journalService.getJournalEntries.mockReturnValue(throwError(() => new HttpErrorResponse({
      error: { message: 'Not Found' },
      status: 404,
      statusText: 'Not Found'
    })));

    fixture.detectChanges();

    expect(component.loadError).toBe(true);
    expect(component.loadErrorMessage).toBe('Die angeforderten Daten wurden nicht gefunden.');
    expect(fixture.nativeElement.textContent).toContain('Die angeforderten Daten wurden nicht gefunden.');
  });
});
