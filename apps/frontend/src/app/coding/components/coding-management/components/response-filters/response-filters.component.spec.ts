import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ResponseFiltersComponent } from './response-filters.component';

describe('ResponseFiltersComponent', () => {
  let component: ResponseFiltersComponent;
  let fixture: ComponentFixture<ResponseFiltersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ResponseFiltersComponent,
        TranslateModule.forRoot(),
        NoopAnimationsModule
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ResponseFiltersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should use all responses as the default response source', () => {
    expect(component.filterParams.responseSource).toBe('all');
    expect(component.responseSourceOptions[0].value).toBe('all');
  });

  it('should render the response source filter before the status filter', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text.indexOf('coding-management.filters.response-source')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('coding-management.filters.response-source'))
      .toBeLessThan(text.indexOf('coding-management.filters.coded-status'));
  });

  it('should emit text filter changes after debounce timeout', done => {
    jest.spyOn(component.filterChange, 'emit');

    component.filterParams.unitName = 'Unit';
    component.onTextFilterChange();

    setTimeout(() => {
      expect(component.filterChange.emit).toHaveBeenCalledWith(component.filterParams);
      done();
    }, 600);
  });

  it('should emit instant filter changes immediately', () => {
    jest.spyOn(component.filterChange, 'emit');

    component.filterParams.codedStatus = '200';
    component.onInstantFilterChange();

    expect(component.filterChange.emit).toHaveBeenCalledWith(component.filterParams);
  });

  it('should emit filterChange when response source changes', () => {
    jest.spyOn(component.filterChange, 'emit');

    component.filterParams.codedStatus = '';
    component.filterParams.responseSource = 'derived';
    component.onInstantFilterChange();

    expect(component.filterChange.emit).toHaveBeenCalledWith(component.filterParams);
  });

  it('should emit a copy of local filter params', () => {
    jest.spyOn(component.filterChange, 'emit');

    component.filterParams.unitName = 'Unit';
    component.onInstantFilterChange();

    const emittedFilterParams = (component.filterChange.emit as jest.Mock).mock.calls[0][0];
    expect(emittedFilterParams).toEqual(component.filterParams);
    expect(emittedFilterParams).not.toBe(component.filterParams);
  });

  it('should not mutate input filter params when a regex filter becomes invalid', () => {
    jest.spyOn(component.filterChange, 'emit');
    const parentFilterParams = {
      ...component.filterParams,
      variableId: 'VAR_01'
    };
    component.filterParams = parentFilterParams;
    component.enableRegexSearch = true;

    component.filterParams.variableId = '[';
    component.onTextFilterChange();

    expect(parentFilterParams.variableId).toBe('VAR_01');
    expect(component.filterChange.emit).not.toHaveBeenCalled();
  });

  it('should keep DERIVE_ERROR as the visible status label', () => {
    expect(component.mapStatusToString('4')).toBe('DERIVE_ERROR');
    expect(component.mapStatusToString('DERIVE_ERROR')).toBe('DERIVE_ERROR');
    expect(component.mapStatusToString('4abc')).toBe('4abc');
  });

  it('should switch GeoGebra searches from all to base responses', () => {
    jest.spyOn(component.filterChange, 'emit');

    component.filterParams.responseSource = 'all';
    component.filterParams.geogebra = true;
    component.onGeoGebraFilterChange();

    expect(component.filterParams.responseSource).toBe('base');
    expect(component.filterChange.emit).toHaveBeenCalledWith(component.filterParams);
  });

  it('should emit clearFilters when clear button is clicked', () => {
    jest.spyOn(component.clearFilters, 'emit');
    component.onClearFilters();
    expect(component.clearFilters.emit).toHaveBeenCalled();
  });

  it('should clear timer on destroy', () => {
    component.onTextFilterChange();
    const componentWithPrivate = component as unknown as { clearFilterTimer: () => void };
    jest.spyOn(componentWithPrivate, 'clearFilterTimer');
    component.ngOnDestroy();
    expect(componentWithPrivate.clearFilterTimer).toHaveBeenCalled();
  });
});
