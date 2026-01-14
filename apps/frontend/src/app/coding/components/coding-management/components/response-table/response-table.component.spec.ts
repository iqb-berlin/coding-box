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
});
