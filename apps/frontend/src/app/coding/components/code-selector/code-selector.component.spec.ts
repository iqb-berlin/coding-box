import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { CodingScheme } from '../../../models/coding-interfaces';
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

  const mixedCodingScheme: CodingScheme = {
    version: '1.0',
    variableCodings: [
      {
        id: 'VAR1',
        alias: 'VAR1',
        label: 'Variable 1',
        sourceType: 'BASE',
        processing: [],
        codeModel: 'MANUAL_AND_RULES',
        manualInstruction: '<p>General instruction</p>',
        codes: [
          {
            id: 1,
            type: 'FULL_CREDIT',
            label: 'Manual code',
            score: 1,
            ruleSetOperatorAnd: false,
            ruleSets: [],
            manualInstruction: '<p>Manual instruction</p>'
          },
          {
            id: 2,
            type: 'RESIDUAL',
            label: 'Auto code',
            score: 0,
            ruleSetOperatorAnd: false,
            ruleSets: [],
            manualInstruction: ''
          },
          {
            id: 3,
            type: 'RESIDUAL',
            label: 'Whitespace code',
            score: 0,
            ruleSetOperatorAnd: false,
            ruleSets: [],
            manualInstruction: '   '
          }
        ]
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

  it('filters regular codes without manual instructions from manual selection', () => {
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false)
    });

    expect(component.regularCodes.map(code => code.id)).toEqual([1]);
    expect(component.codingIssueOptionCodes).toHaveLength(4);
  });

  it('keeps manual codes selectable when mixed with empty manual instructions', () => {
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    const emitSpy = jest.spyOn(component.codeSelected, 'emit');

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false)
    });
    component.onSelect(1);

    expect(component.selectedCode).toBe(1);
    expect(emitSpy).toHaveBeenCalledWith({
      variableId: 'VAR1',
      code: mixedCodingScheme.variableCodings[0].codes[0],
      codingIssueOption: null
    });
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

  it('toggleVariablePanel should focus active variable item when opened', () => {
    jest.useFakeTimers();
    const panel = document.createElement('div');
    panel.className = 'variable-panel';
    const activeItem = document.createElement('div');
    activeItem.className = 'variable-panel-item active';
    activeItem.setAttribute('tabindex', '-1');
    panel.appendChild(activeItem);

    const scrollSpy = jest.fn();
    // jsdom does not implement scrollIntoView in all environments.
    (activeItem as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollSpy;
    const focusSpy = jest.spyOn(activeItem, 'focus').mockImplementation(() => { });
    (component as unknown as { variablePanel: { nativeElement: HTMLElement } }).variablePanel = { nativeElement: panel };

    component.toggleVariablePanel();
    jest.runAllTimers();

    expect(component.isVariablePanelOpen).toBe(true);
    expect(scrollSpy).toHaveBeenCalled();
    expect(focusSpy).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('hides the pause button for completed job reviews', () => {
    component.showProgress = true;
    component.hasCodingJob = true;
    component.isCodingJobCompleted = false;
    component.isCompletedJobReview = true;

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.pause-button')).toBeNull();
  });
});
