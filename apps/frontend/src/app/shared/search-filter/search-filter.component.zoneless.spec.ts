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
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.destroy();
    jest.advanceTimersByTime(500);
    expect(changed).not.toHaveBeenCalled();
  });

  it('emits a typed value after debouncing without another interaction', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const clear = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    clear.click();
    await fixture.whenStable();
    expect(clear.disabled).toBe(true);
    const changed = jest.fn();
    fixture.componentInstance.valueChange.subscribe(changed);
    input.value = 'Delayed filter';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'r', bubbles: true }));
    const deadline = Date.now() + 2000;
    while (!changed.mock.calls.length && Date.now() < deadline) {
      await new Promise(resolve => { setTimeout(resolve, 20); });
    }
    await fixture.whenStable();
    expect(changed).toHaveBeenCalledWith('Delayed filter');
    expect(clear.disabled).toBe(false);
  });

  it('enables clearing pasted text immediately and emits it after the debounce without keyup', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const clear = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    clear.click();
    await fixture.whenStable();
    const changed = jest.fn();
    fixture.componentInstance.valueChange.subscribe(changed);

    input.value = 'Pasted text';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(input.value).toBe('Pasted text');
    expect(clear.disabled).toBe(false);
    expect(changed).not.toHaveBeenCalled();

    await new Promise(resolve => { setTimeout(resolve, 400); });
    await fixture.whenStable();
    expect(changed.mock.calls).toEqual([['Pasted text']]);
  });

  it('clears pasted text and cancels its pending filter output', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const clear = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    clear.click();
    await fixture.whenStable();
    const changed = jest.fn();
    fixture.componentInstance.valueChange.subscribe(changed);

    input.value = 'Pending paste';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    clear.click();
    await fixture.whenStable();
    expect(input.value).toBe('');
    expect(clear.disabled).toBe(true);
    expect(changed.mock.calls).toEqual([['']]);

    await new Promise(resolve => { setTimeout(resolve, 400); });
    await fixture.whenStable();
    expect(changed.mock.calls).toEqual([['']]);
  });

  it('debounces consecutive input events and immediately disables clearing an empty input', async () => {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    const clear = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    const changed = jest.fn();
    fixture.componentInstance.valueChange.subscribe(changed);
    input.value = 'Older input';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = 'Latest input';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => { setTimeout(resolve, 400); });
    await fixture.whenStable();
    expect(changed.mock.calls).toEqual([['Latest input']]);

    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(clear.disabled).toBe(true);
    await new Promise(resolve => { setTimeout(resolve, 400); });
    await fixture.whenStable();
    expect(changed.mock.calls).toEqual([['Latest input'], ['']]);
  });
});
