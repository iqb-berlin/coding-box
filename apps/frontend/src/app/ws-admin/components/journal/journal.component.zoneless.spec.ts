import { computed, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { MatSelectHarness } from '@angular/material/select/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { JournalService } from '../../../core/services/journal.service';
import { JournalComponent } from './journal.component';

describe('Journal filters without ZoneJS', () => {
  let fixture: ComponentFixture<JournalComponent>;
  let getJournalEntries: jest.Mock;

  beforeEach(async () => {
    getJournalEntries = jest.fn().mockReturnValue(of({
      data: [], total: 0, page: 1, limit: 20
    }));
    await TestBed.configureTestingModule({
      imports: [JournalComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: AppService, useValue: { selectedWorkspaceId: 5 } },
        { provide: JournalService, useValue: { getJournalEntries } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(JournalComponent);
    await fixture.whenStable();
  });

  it('updates derived filters through all form controls without changing earlier snapshots', async () => {
    const component = fixture.componentInstance;
    const derivedFilters = computed(() => ({ ...component.filters() }));
    const initialFilters = component.filters();
    expect(derivedFilters()).toEqual({});
    const selects = await TestbedHarnessEnvironment.loader(fixture).getAllHarnesses(MatSelectHarness);

    await selects[0].open();
    await selects[0].clickOptions({ text: 'CODING_JOB_CREATED' });
    expect(derivedFilters()).toEqual({ eventType: 'CODING_JOB_CREATED' });
    const eventFilters = component.filters();

    await selects[1].open();
    await selects[1].clickOptions({ text: 'journal.result-success' });
    expect(derivedFilters()).toEqual({ eventType: 'CODING_JOB_CREATED', result: 'success' });
    const resultFilters = component.filters();

    const dates = fixture.nativeElement.querySelectorAll('input[type="date"]') as NodeListOf<HTMLInputElement>;
    dates[0].value = '2026-10-01';
    dates[0].dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(derivedFilters()).toMatchObject({ fromDate: '2026-10-01' });
    const fromDateFilters = component.filters();

    dates[1].value = '2026-10-03';
    dates[1].dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(derivedFilters()).toEqual({
      eventType: 'CODING_JOB_CREATED', result: 'success', fromDate: '2026-10-01', toDate: '2026-10-03'
    });
    expect(initialFilters).toEqual({});
    expect(eventFilters).toEqual({ eventType: 'CODING_JOB_CREATED' });
    expect(resultFilters).toEqual({ eventType: 'CODING_JOB_CREATED', result: 'success' });
    expect(fromDateFilters).toEqual({ eventType: 'CODING_JOB_CREATED', result: 'success', fromDate: '2026-10-01' });
    expect(getJournalEntries).toHaveBeenCalledTimes(1);

    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(getJournalEntries).toHaveBeenLastCalledWith(
      5, 1, 20, derivedFilters(), { suppressGlobalError: true }
    );

    await selects[0].open();
    await selects[0].clickOptions({ text: 'journal.all' });
    await selects[1].open();
    await selects[1].clickOptions({ text: 'journal.all' });
    for (const date of dates) {
      date.value = '';
      date.dispatchEvent(new Event('input', { bubbles: true }));
      await fixture.whenStable();
    }
    expect(derivedFilters()).toEqual({
      eventType: undefined, result: undefined, fromDate: undefined, toDate: undefined
    });
    expect(getJournalEntries).toHaveBeenCalledTimes(2);
  });
});
