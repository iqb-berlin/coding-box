import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { TestResultsSearchComponent } from './test-results-search.component';
import { QuickSearchResult, TestResultService } from '../../../shared/services/test-result/test-result.service';
import { AppService } from '../../../core/services/app.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';

describe('TestResultsSearchComponent zoneless responses', () => {
  let fixture: ComponentFixture<TestResultsSearchComponent>;
  let response: Subject<QuickSearchResult>;
  let quickSearch: jest.Mock;

  beforeEach(async () => {
    response = new Subject<QuickSearchResult>();
    quickSearch = jest.fn().mockImplementation(() => response);
    await TestBed.configureTestingModule({
      imports: [TestResultsSearchComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: { title: 'Schnellsuche' } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: TestResultService, useValue: { quickSearch } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        { provide: CodingStatisticsService, useValue: {} }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(TestResultsSearchComponent);
    await fixture.whenStable();
  });

  async function enterQuery(query: string): Promise<void> {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    await new Promise(resolve => { setTimeout(resolve, fixture.componentInstance.SEARCH_DEBOUNCE_TIME + 50); });
    await fixture.whenStable();
  }

  async function receivePerson(): Promise<void> {
    response.next({
      query: 'P01',
      limit: 8,
      persons: [{
        kind: 'person', id: 7, label: 'Person P01', personId: 7
      }],
      booklets: [],
      units: [],
      responses: [],
      totals: {
        person: 1, booklet: 0, unit: 0, response: 0
      }
    });
    response.complete();
    await fixture.whenStable();
  }

  it('renders loading and delayed results without another interaction', async () => {
    await enterQuery('P01');
    expect(quickSearch).toHaveBeenCalledWith(1, 'P01', 8);
    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Suche läuft...');

    await receivePerson();

    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.result-item')?.textContent).toContain('Person P01');
    expect(fixture.nativeElement.querySelector('.type-count')?.textContent.trim()).toBe('1');
  });

  it('ends loading and removes previous results after a delayed error', async () => {
    await enterQuery('P01');
    await receivePerson();
    response = new Subject<QuickSearchResult>();
    await enterQuery('P02');
    expect(fixture.nativeElement.querySelector('mat-spinner')).not.toBeNull();

    response.error(new Error('Search failed'));
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('mat-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.result-item')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Keine Treffer gefunden.');
    expect(fixture.nativeElement.querySelector('.type-count')?.textContent.trim()).toBe('0');
  });

  it('clears the result counts after the query falls below the minimum length', async () => {
    await enterQuery('P01');
    await receivePerson();

    await enterQuery('P');

    expect(quickSearch).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('.result-item')).toBeNull();
    expect(fixture.nativeElement.querySelector('.type-count')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Geben Sie mindestens 2 Zeichen ein.');
  });
});
