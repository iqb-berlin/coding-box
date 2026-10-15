import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ResponseFiltersComponent } from './response-filters.component';

describe('Response filter input and local draft without Zone.js', () => {
  let fixture: ComponentFixture<ResponseFiltersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ResponseFiltersComponent, TranslateModule.forRoot()],
      providers: [provideZonelessChangeDetection()]
    }).compileComponents();
    fixture = TestBed.createComponent(ResponseFiltersComponent);
  });

  afterEach(() => fixture.destroy());

  it('edits and emits a local copy without changing the parent input', async () => {
    const parentFilters = Object.freeze({ ...fixture.componentInstance.filterParams(), unitName: 'Original' });
    fixture.componentRef.setInput('filterParams', parentFilters);
    const changes = jest.fn();
    fixture.componentInstance.filterChange.subscribe(changes);
    const emitted = new Promise(resolve => { fixture.componentInstance.filterChange.subscribe(resolve); });
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Original');
    input.value = 'Edited';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await emitted;
    await fixture.whenStable();

    expect(parentFilters.unitName).toBe('Original');
    expect(fixture.componentInstance.filterParams()).toBe(parentFilters);
    expect(changes).toHaveBeenCalledWith(expect.objectContaining({ unitName: 'Edited' }));
    expect(changes.mock.calls[0][0]).not.toBe(parentFilters);
  });

  it('replaces the edited draft and rendered controls when the parent resets filters', async () => {
    await fixture.whenStable();
    fixture.componentInstance.setFilterValue('unitName', 'Edited');
    const replacement = Object.freeze({ ...fixture.componentInstance.filterParams(), unitName: 'Reset' });
    const changes = jest.fn();
    fixture.componentInstance.filterChange.subscribe(changes);
    fixture.componentRef.setInput('filterParams', replacement);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('input').value).toBe('Reset');
    expect(fixture.componentInstance.draftFilterParams().unitName).toBe('Reset');
    expect(changes).not.toHaveBeenCalled();
  });
});
