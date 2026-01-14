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

  it('should emit filterChange after debounce timeout', done => {
    jest.spyOn(component.filterChange, 'emit');

    component.filterParams.codedStatus = '200';
    component.onFilterChange();

    setTimeout(() => {
      expect(component.filterChange.emit).toHaveBeenCalledWith(component.filterParams);
      done();
    }, 600);
  });

  it('should emit filterChange immediately when codedStatus is empty', () => {
    jest.spyOn(component.filterChange, 'emit');

    component.filterParams.codedStatus = '';
    component.onFilterChange();

    expect(component.filterChange.emit).toHaveBeenCalledWith(component.filterParams);
  });

  it('should emit clearFilters when clear button is clicked', () => {
    jest.spyOn(component.clearFilters, 'emit');
    component.onClearFilters();
    expect(component.clearFilters.emit).toHaveBeenCalled();
  });

  it('should clear timer on destroy', () => {
    component.onFilterChange();
    const componentWithPrivate = component as unknown as { clearFilterTimer: () => void };
    jest.spyOn(componentWithPrivate, 'clearFilterTimer');
    component.ngOnDestroy();
    expect(componentWithPrivate.clearFilterTimer).toHaveBeenCalled();
  });
});
