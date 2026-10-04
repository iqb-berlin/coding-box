import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { SearchFilterComponent } from './search-filter.component';

describe('Search filter view initialization without Zone.js', () => {
  let fixture: ComponentFixture<SearchFilterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchFilterComponent, TranslateModule.forRoot()],
      providers: [provideZonelessChangeDetection()]
    }).compileComponents();
    fixture = TestBed.createComponent(SearchFilterComponent);
    fixture.componentRef.setInput('title', 'Search');
    fixture.componentRef.setInput('initialValue', 'Initial');
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    jest.useRealTimers();
  });

  it('renders the initial value before querying the input and clears it through the UI', async () => {
    const element = fixture.nativeElement as HTMLElement;
    expect((element.querySelector('input') as HTMLInputElement).value).toBe('Initial');
    const clear = element.querySelector('button') as HTMLButtonElement;
    expect(clear.disabled).toBe(false);
    const changed = jest.fn();
    fixture.componentInstance.valueChange.subscribe(changed);
    clear.click();
    await fixture.whenStable();
    expect((element.querySelector('input') as HTMLInputElement).value).toBe('');
    expect(changed).toHaveBeenCalledWith('');
    expect(clear.disabled).toBe(true);
  });

  it('cancels a queued debounce when the view is destroyed', () => {
    jest.useFakeTimers();
    const changed = jest.fn();
    fixture.componentInstance.valueChange.subscribe(changed);
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'Queued';
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', bubbles: true }));
    fixture.destroy();
    jest.advanceTimersByTime(500);
    expect(changed).not.toHaveBeenCalled();
  });
});
