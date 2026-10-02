import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { VariableAnalysisDialogComponent } from './variable-analysis-dialog.component';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { WorkspaceSettingsService } from '../../../ws-admin/services/workspace-settings.service';
import { AppService } from '../../../core/services/app.service';
import { VariableAnalysisItemDto } from '../../../../../../../api-dto/coding/variable-analysis-item.dto';

interface VariableAnalysisResponse {
  data: VariableAnalysisItemDto[];
  total: number;
  page: number;
  limit: number;
}

describe('Code/score distribution without Zone', () => {
  let fixture: ComponentFixture<VariableAnalysisDialogComponent>;
  let requests: Subject<VariableAnalysisResponse>[];
  let getVariableAnalysis: jest.Mock;
  let openSnackBar: jest.Mock;

  async function waitForIdle(): Promise<void> {
    // Let initial Material notifications finish before simulating a network reply.
    await new Promise(resolve => { setTimeout(resolve, 150); });
    await fixture.whenStable();
  }

  function response(unitId = 'UNIT_ASYNC'): VariableAnalysisResponse {
    return {
      data: [{
        replayUrl: '/replay/example',
        unitId,
        variableId: 'VAR_A',
        derivation: '',
        code: '1',
        description: '',
        score: 1,
        occurrenceCount: 7,
        totalCount: 10,
        relativeOccurrence: 0.7
      }],
      total: 1,
      page: 1,
      limit: 200
    };
  }

  function loadingView(): Element | null {
    return fixture.nativeElement.querySelector('.loading-container');
  }

  beforeEach(async () => {
    requests = [];
    getVariableAnalysis = jest.fn(() => {
      const request = new Subject<VariableAnalysisResponse>();
      requests.push(request);
      return request;
    });
    openSnackBar = jest.fn();
    await TestBed.configureTestingModule({
      imports: [VariableAnalysisDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 5 } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: CodingStatisticsService, useValue: { getVariableAnalysis } },
        { provide: WorkspaceSettingsService, useValue: { getEnableRegexSearch: () => of(false) } },
        { provide: AppService, useValue: { selectedWorkspaceId: 5 } },
        { provide: MatSnackBar, useValue: { open: openSnackBar } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(VariableAnalysisDialogComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    await waitForIdle();
  });

  afterEach(() => fixture.destroy());

  it('renders a delayed initial response and its pagination without another interaction', async () => {
    expect(loadingView()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.coding-table')).toBeNull();

    requests[0].next({
      ...response(), total: 3, page: 2, limit: 1
    });
    await fixture.whenStable();

    expect(loadingView()).toBeNull();
    expect(fixture.nativeElement.querySelector('.coding-table')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('UNIT_ASYNC');
    expect(fixture.nativeElement.querySelector('.result-context-number').textContent.trim()).toBe('3');
    expect(fixture.nativeElement.querySelector('.mat-mdc-paginator-range-label').textContent.trim())
      .toBe('2 - 2 von 3 Verteilungszeilen');
  });

  it('replaces the loading view with the empty state for an empty delayed response', async () => {
    requests[0].next({
      data: [], total: 0, page: 1, limit: 200
    });
    await fixture.whenStable();

    expect(loadingView()).toBeNull();
    expect(fixture.nativeElement.querySelector('.coding-table')).toBeNull();
    expect(fixture.nativeElement.querySelector('.empty-state').textContent)
      .toContain('Keine Code-/Score-Daten verfügbar');
  });

  it('ends loading after an error and renders a successful retry', async () => {
    requests[0].error(new Error('Network request failed'));
    await fixture.whenStable();

    expect(loadingView()).toBeNull();
    expect(fixture.nativeElement.querySelector('.empty-state')).not.toBeNull();
    expect(openSnackBar).toHaveBeenCalledWith(
      'Fehler beim Abrufen der Code-/Score-Verteilung',
      'Schließen',
      expect.objectContaining({ duration: 5000 })
    );

    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    const applyFilter = buttons.find(button => button.textContent?.includes('Filter anwenden'));
    expect(applyFilter).toBeDefined();
    applyFilter!.click();
    await fixture.whenStable();
    expect(loadingView()).not.toBeNull();
    expect(getVariableAnalysis).toHaveBeenCalledTimes(2);
    await waitForIdle();

    requests[1].next(response('UNIT_RETRY'));
    await fixture.whenStable();

    expect(loadingView()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('UNIT_RETRY');
    expect(fixture.nativeElement.querySelector('.empty-state')).toBeNull();
  });

  it('renders loading when a debounced filter starts and then displays its delayed response', async () => {
    requests[0].next(response());
    await fixture.whenStable();
    await waitForIdle();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'UNIT_FILTERED';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    await new Promise(resolve => { setTimeout(resolve, 600); });
    await fixture.whenStable();

    expect(getVariableAnalysis).toHaveBeenLastCalledWith(
      5, 1, 200, 'UNIT_FILTERED', undefined, undefined, false
    );
    expect(loadingView()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.coding-table')).toBeNull();
    await waitForIdle();

    requests[1].next(response('UNIT_FILTERED'));
    await fixture.whenStable();

    expect(loadingView()).toBeNull();
    expect(fixture.nativeElement.querySelector('.coding-table').textContent).toContain('UNIT_FILTERED');
  });
});
