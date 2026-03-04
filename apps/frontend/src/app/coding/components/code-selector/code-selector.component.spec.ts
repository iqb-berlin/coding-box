import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { CodeSelectorComponent } from './code-selector.component';

describe('CodeSelectorComponent', () => {
  let component: CodeSelectorComponent;
  let fixture: ComponentFixture<CodeSelectorComponent>;

  const interleavedUnitsData = {
    id: 1,
    name: 'job',
    currentUnitIndex: 0,
    units: [
      {
        id: 1,
        name: 'UNIT1',
        alias: 'UNIT1',
        bookletId: 0,
        testPerson: 'tp1@code1@grp@booklet',
        variableId: 'V1',
        variableAnchor: 'V1'
      },
      {
        id: 2,
        name: 'UNIT1',
        alias: 'UNIT1',
        bookletId: 0,
        testPerson: 'tp2@code2@grp@booklet',
        variableId: 'V2',
        variableAnchor: 'V2'
      },
      {
        id: 3,
        name: 'UNIT1',
        alias: 'UNIT1',
        bookletId: 0,
        testPerson: 'tp3@code3@grp@booklet',
        variableId: 'V1',
        variableAnchor: 'V1'
      }
    ]
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FormsModule, TranslateModule.forRoot(), CodeSelectorComponent]
    })
      .compileComponents();

    fixture = TestBed.createComponent(CodeSelectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('nextUnit should navigate to immediate next case for interleaved variables', () => {
    component.unitsData = {
      ...interleavedUnitsData,
      currentUnitIndex: 0
    };
    component.selectedCode = 1;
    const emitSpy = jest.spyOn(component.unitChanged, 'emit');

    component.nextUnit();

    expect(emitSpy).toHaveBeenCalledWith(component.unitsData.units[1]);
  });

  it('previousUnit should navigate to immediate previous case for interleaved variables', () => {
    component.unitsData = {
      ...interleavedUnitsData,
      currentUnitIndex: 2
    };
    const emitSpy = jest.spyOn(component.unitChanged, 'emit');

    component.previousUnit();

    expect(emitSpy).toHaveBeenCalledWith(component.unitsData.units[1]);
  });
});
