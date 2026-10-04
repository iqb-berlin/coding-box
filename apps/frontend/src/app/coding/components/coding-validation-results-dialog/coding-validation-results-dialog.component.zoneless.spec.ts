import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { CodingValidationResultsDialogComponent } from './coding-validation-results-dialog.component';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';

describe('CodingValidationResultsDialogComponent without ZoneJS', () => {
  let fixture: ComponentFixture<CodingValidationResultsDialogComponent>;
  let pageResponse: Subject<ValidateCodingCompletenessResponseDto>;
  let downloadResponse: Subject<Blob>;
  let closing: Subject<void>;
  let workspace: { selectedWorkspaceId: number; selectedWorkspaceId$: Subject<number> };
  let service: { validateCodingCompleteness: jest.Mock; downloadValidationResultsAsExcel: jest.Mock };

  const page = (currentPage: number, empty = false): ValidateCodingCompletenessResponseDto => ({
    total: 100,
    missing: 100,
    currentPage,
    pageSize: 50,
    totalPages: 2,
    hasNextPage: currentPage === 1,
    hasPreviousPage: currentPage === 2,
    cacheKey: `cache-${currentPage}`,
    results: empty ? [] : [{
      combination: {
        unit_key: `Unit${currentPage}`,
        login_name: 'login1',
        login_code: 'person1',
        booklet_id: 'booklet1',
        variable_id: `variable${currentPage}`
      },
      status: 'MISSING'
    }]
  });

  const button = (translationKey: string): HTMLButtonElement => {
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    return buttons.find(element => element.textContent?.includes(translationKey))!;
  };

  const idle = async (): Promise<void> => {
    await fixture.whenStable();
    // Material initialization must finish before an external response can expose a missing notification.
    await new Promise(resolve => { setTimeout(resolve, 150); });
    await fixture.whenStable();
  };

  beforeEach(async () => {
    closing = new Subject<void>();
    workspace = { selectedWorkspaceId: 5, selectedWorkspaceId$: new Subject<number>() };
    pageResponse = new Subject<ValidateCodingCompletenessResponseDto>();
    downloadResponse = new Subject<Blob>();
    service = {
      validateCodingCompleteness: jest.fn(() => pageResponse),
      downloadValidationResultsAsExcel: jest.fn(() => downloadResponse)
    };
    await TestBed.configureTestingModule({
      imports: [CodingValidationResultsDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: { validationResults: page(1), validationCacheKey: 'cache-1', expectedCombinations: [] } },
        { provide: MatDialogRef, useValue: { close: jest.fn(() => closing.next()), beforeClosed: () => closing } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: AppService, useValue: workspace },
        { provide: TestPersonCodingService, useValue: service }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(CodingValidationResultsDialogComponent);
    fixture.autoDetectChanges();
    await idle();
  });

  afterEach(() => {
    fixture.destroy();
    jest.restoreAllMocks();
  });

  it('renders delayed pagination results and updates navigation controls', async () => {
    button('next-page').click();
    await idle();
    expect(button('download-button').disabled).toBe(true);

    pageResponse.next(page(2));
    pageResponse.complete();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.pagination-info').textContent).toContain('Seite 2 von 2');
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain('Unit2');
    expect(button('next-page').disabled).toBe(true);
    expect(button('previous-page').disabled).toBe(false);
    expect(button('download-button').disabled).toBe(false);
    expect(service.validateCodingCompleteness).toHaveBeenCalledWith(5, [], 2, 50);
  });

  it('removes old rows when a delayed page is empty', async () => {
    button('next-page').click();
    await idle();

    pageResponse.next(page(2, true));
    pageResponse.complete();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.results-table')).toBeNull();
    expect(fixture.nativeElement.querySelector('.pagination-info').textContent).toContain('Seite 2 von 2');
    expect(button('download-button').disabled).toBe(false);
  });

  it('clears loading after a page error and renders a successful retry', async () => {
    button('next-page').click();
    await idle();
    pageResponse.error(new Error('request failed'));
    await fixture.whenStable();

    expect(button('download-button').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.pagination-info').textContent).toContain('Seite 1 von 2');

    pageResponse = new Subject<ValidateCodingCompletenessResponseDto>();
    button('next-page').click();
    await idle();
    pageResponse.next(page(2));
    pageResponse.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tbody').textContent).toContain('Unit2');
  });

  it.each(['success', 'error'])('reenables the download button after a delayed download %s', async outcome => {
    const createObjectURL = jest.fn(() => 'blob:validation-results');
    const revokeObjectURL = jest.fn();
    Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    button('download-button').click();
    await idle();
    expect(button('download-button').disabled).toBe(true);

    if (outcome === 'success') {
      downloadResponse.next(new Blob(['results']));
      downloadResponse.complete();
    } else {
      downloadResponse.error({ status: 500 });
    }
    await fixture.whenStable();

    expect(button('download-button').disabled).toBe(false);
    expect(click).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
    expect(service.downloadValidationResultsAsExcel).toHaveBeenCalledWith(5, 'cache-1');
    if (outcome === 'success') expect(revokeObjectURL).toHaveBeenCalledWith('blob:validation-results');
  });
  it('cancels the older page size request and keeps the latest cache key', async () => {
    fixture.componentInstance.changePageSize(100);
    const oldPage = pageResponse;
    pageResponse = new Subject<ValidateCodingCompletenessResponseDto>();
    fixture.componentInstance.changePageSize(200);
    expect(oldPage.observed).toBe(false);
    oldPage.next(page(2));
    oldPage.error(new Error('late failure'));
    await fixture.whenStable();
    expect(button('download-button').disabled).toBe(true);
    pageResponse.next({ ...page(1), cacheKey: 'latest-cache', pageSize: 200 });
    pageResponse.complete();
    await fixture.whenStable();
    expect(fixture.componentInstance.validationCacheKey).toBe('latest-cache');
    expect(fixture.nativeElement.querySelector('.pagination-info').textContent).toContain('Seite 1 von 2');
  });

  it.each(['close', 'destroy', 'workspace'])('cancels the pending Excel response on %s', async reason => {
    const createObjectURL = jest.fn();
    Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    fixture.componentInstance.downloadExcel();
    if (reason === 'close') closing.next();
    if (reason === 'destroy') fixture.destroy();
    if (reason === 'workspace') {
      workspace.selectedWorkspaceId = 6;
      workspace.selectedWorkspaceId$.next(6);
      workspace.selectedWorkspaceId = 5;
      workspace.selectedWorkspaceId$.next(5);
    }
    expect(downloadResponse.observed).toBe(false);
    downloadResponse.next(new Blob(['late']));
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
