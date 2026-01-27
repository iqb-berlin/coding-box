import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ValidationDataTableComponent, ValidationTableColumn } from './validation-data-table.component';

interface TestData {
  id: number;
  name: string;
  status: string;
}

describe('ValidationDataTableComponent', () => {
  let component: ValidationDataTableComponent<TestData>;
  let fixture: ComponentFixture<ValidationDataTableComponent<TestData>>;

  const mockData: TestData[] = [
    { id: 1, name: 'Item 1', status: 'OK' },
    { id: 2, name: 'Item 2', status: 'Error' }
  ];

  const mockColumns: ValidationTableColumn[] = [
    { key: 'select', label: 'Select', type: 'checkbox' as const },
    { key: 'name', label: 'Name', type: 'link' as const },
    { key: 'status', label: 'Status' }
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        CommonModule,
        MatTableModule,
        MatPaginatorModule,
        MatCheckboxModule,
        MatIconModule,
        NoopAnimationsModule,
        ValidationDataTableComponent
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ValidationDataTableComponent<TestData>);
    component = fixture.componentInstance;
    component.data = mockData;
    component.columns = mockColumns;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render table rows for data', () => {
    const rows = fixture.nativeElement.querySelectorAll('tr.mat-mdc-row');
    expect(rows.length).toBe(2);
  });

  it('should emit linkClick when a link is clicked', () => {
    // Re-detect changes to ensure link is rendered
    fixture.detectChanges();

    const emitSpy = jest.spyOn(component.linkClick, 'emit');
    const link = fixture.nativeElement.querySelector('a');
    link.click();

    expect(emitSpy).toHaveBeenCalledWith({
      item: mockData[0],
      columnKey: 'name'
    });
  });

  it('should emit selectionChange when selection changes', () => {
    const emitSpy = jest.spyOn(component.selectionChange, 'emit');
    component.toggleSelection(mockData[0]);
    expect(emitSpy).toHaveBeenCalled();

    const newSet = emitSpy.mock.calls[0][0] as Set<number>;
    expect(newSet.has(1)).toBe(true);
  });
});
