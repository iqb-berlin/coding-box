import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { PageEvent } from '@angular/material/paginator';
import { ResponseTableComponent } from './response-table.component';
import { Success } from '../../../../models/success.model';

describe('ResponseTableComponent', () => {
  let component: ResponseTableComponent;
  let fixture: ComponentFixture<ResponseTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ResponseTableComponent,
        TranslateModule.forRoot(),
        NoopAnimationsModule
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ResponseTableComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should update dataSource when data changes', () => {
    const testData = [
      { id: 1, unitname: 'Test Unit' } as Success
    ];
    component.data = testData;
    component.ngOnChanges({
      data: {
        currentValue: testData, previousValue: [], firstChange: false, isFirstChange: () => false
      }
    });
    expect(component.dataSource.data).toEqual(testData);
  });

  it('should emit pageChange when pagination changes', () => {
    jest.spyOn(component.pageChange, 'emit');
    const event = { pageIndex: 1, pageSize: 100, length: 200 } as PageEvent;
    component.onPageChange(event);
    expect(component.pageChange.emit).toHaveBeenCalledWith(event);
  });

  it('should emit replayClick when replay button is clicked', () => {
    jest.spyOn(component.replayClick, 'emit');
    const response = { id: 1 } as Success;
    component.onReplayClick(response);
    expect(component.replayClick.emit).toHaveBeenCalledWith(response);
  });

  it('should emit showCodingScheme when coding scheme button is clicked', () => {
    jest.spyOn(component.showCodingScheme, 'emit');
    component.onShowCodingScheme(123);
    expect(component.showCodingScheme.emit).toHaveBeenCalledWith(123);
  });

  it('should emit showUnitXml when unit name is clicked', () => {
    jest.spyOn(component.showUnitXml, 'emit');
    component.onShowUnitXml(456);
    expect(component.showUnitXml.emit).toHaveBeenCalledWith(456);
  });

  it('should format status string correctly', () => {
    expect(component.getStatusString('200')).toBeTruthy();
    expect(component.getStatusString('')).toBe('');
  });

  it('should expose the selected version label for the table header', () => {
    component.selectedVersion = 'v3';

    expect(component.getSelectedVersionLabel()).toBe('coding-management.statistics.second-autocode-run');
  });

  it('should recognize GeoGebra response values', () => {
    expect(component.isGeoGebraValue('UEsDBBQAAAAI')).toBe(true);
    expect(component.isGeoGebraValue('data:application/octet-stream;base64,UEsDBBQAAAAI')).toBe(true);
    expect(component.isGeoGebraValue('regular answer')).toBe(false);
    expect(component.isGeoGebraValue(null)).toBe(false);
  });

  it('should download GeoGebra response values as ggb files', () => {
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      value: jest.fn().mockReturnValue('blob:test')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      value: jest.fn()
    });
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation();

    component.downloadGeoGebraValue({
      value: 'UEsD',
      unitname: 'Unit 1',
      variableid: 'var/1'
    } as Success);

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');

    clickSpy.mockRestore();
  });

  it('should return correct label for filter status', () => {
    component.currentStatusFilter = '200';
    expect(component.getFilterStatusLabel()).toBeTruthy();

    component.currentStatusFilter = 'null';
    expect(component.getFilterStatusLabel()).toBe('');

    component.currentStatusFilter = null;
    expect(component.getFilterStatusLabel()).toBe('');

    component.currentStatusFilter = 'invalid';
    expect(component.getFilterStatusLabel()).toBe('invalid');
  });
});
