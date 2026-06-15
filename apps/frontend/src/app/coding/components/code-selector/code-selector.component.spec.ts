import { SimpleChange } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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

  const issueOnlyCodingScheme: CodingScheme = {
    version: '1.0',
    variableCodings: [
      {
        id: 'VAR2',
        alias: 'VAR2',
        label: 'Variable 2',
        sourceType: 'BASE',
        processing: [],
        codeModel: 'MANUAL_AND_RULES',
        manualInstruction: '<p>Only general instruction</p>',
        codes: [
          {
            id: 4,
            type: 'RESIDUAL',
            label: 'Auto code',
            score: 0,
            ruleSetOperatorAnd: false,
            ruleSets: [],
            manualInstruction: ''
          },
          {
            id: 5,
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

  it('keeps available coding issue options and general instructions visible without regular manual codes', () => {
    component.codingScheme = issueOnlyCodingScheme;
    component.variableId = 'VAR2';
    const emitSpy = jest.spyOn(component.codeSelected, 'emit');

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, issueOnlyCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR2', false)
    });
    fixture.detectChanges();

    expect(component.regularCodes).toEqual([]);
    expect(component.codingIssueOptionCodes.map(code => code.id)).toEqual([-1, -3, -4, -2]);
    expect(fixture.nativeElement.querySelector('.general-instruction-row').textContent).toContain(
      'Only general instruction'
    );
    expect(fixture.nativeElement.querySelectorAll('.uncertain-codes-section .code-row')).toHaveLength(4);

    component.onSelect(-1);
    expect(emitSpy).not.toHaveBeenCalled();

    component.onSelect(-2);
    expect(emitSpy).toHaveBeenLastCalledWith({
      variableId: 'VAR2',
      code: null,
      codingIssueOption: expect.objectContaining({ code: -2 })
    });
  });

  it('hides comment-bound coding issue options when comments are disabled', () => {
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.allowComments = false;
    const emitSpy = jest.spyOn(component.codeSelected, 'emit');

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false)
    });
    fixture.detectChanges();

    expect(component.codingIssueOptionCodes.map(code => code.id)).toEqual([-3, -4]);
    expect(fixture.nativeElement.querySelectorAll('.uncertain-codes-section .code-row')).toHaveLength(2);

    component.onSelect(-1);
    component.onSelect(-2);

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('does not preselect hidden comment-bound coding issue options when comments are disabled', () => {
    jest.useFakeTimers();
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.allowComments = false;
    component.preSelectedCodeId = -2;
    component.preSelectedCodingIssueOptionId = -2;

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false),
      preSelectedCodeId: new SimpleChange(null, -2, false),
      preSelectedCodingIssueOptionId: new SimpleChange(null, -2, false)
    });
    jest.runOnlyPendingTimers();
    fixture.detectChanges();

    expect(component.codingIssueOptionCodes.map(code => code.id)).toEqual([-3, -4]);
    expect(component.selectedCode).toBeNull();
    expect(component.selectedCodingIssueOption).toBeNull();
    expect(component.legacySelectedCode).toBeNull();
    jest.useRealTimers();
  });

  it('clears selected comment-bound coding issue options when comments are disabled later', () => {
    jest.useFakeTimers();
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.preSelectedCodeId = -2;
    component.preSelectedCodingIssueOptionId = -2;

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false),
      preSelectedCodeId: new SimpleChange(null, -2, false),
      preSelectedCodingIssueOptionId: new SimpleChange(null, -2, false)
    });
    jest.runOnlyPendingTimers();

    expect(component.selectedCodingIssueOption).toBe(-2);

    component.allowComments = false;
    component.ngOnChanges({
      allowComments: new SimpleChange(true, false, false)
    });

    expect(component.selectedCode).toBeNull();
    expect(component.selectedCodingIssueOption).toBeNull();
    expect(component.legacySelectedCode).toBeNull();
    jest.useRealTimers();
  });

  it('requires a regular code before selecting code-assignment-uncertain', () => {
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    const emitSpy = jest.spyOn(component.codeSelected, 'emit');

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false)
    });

    component.onSelect(-1);

    expect(component.selectedCodingIssueOption).toBeNull();
    expect(emitSpy).not.toHaveBeenCalled();

    component.onSelect(1);
    component.onSelect(-1);

    expect(component.selectedCode).toBe(1);
    expect(component.selectedCodingIssueOption).toBe(-1);
    expect(emitSpy).toHaveBeenLastCalledWith({
      variableId: 'VAR1',
      code: mixedCodingScheme.variableCodings[0].codes[0],
      codingIssueOption: expect.objectContaining({ code: -1 })
    });
  });

  it('shows progress in a compact summary with open count in the tooltip', () => {
    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      replay: {
        'coding-progress': 'Kodierfortschritt:',
        'open-count': 'Offen:'
      }
    });
    translateService.setDefaultLang('de');
    translateService.use('de');

    component.showProgress = true;
    component.completedCount = 6;
    component.totalUnits = 80;
    component.progressPercentage = 8;
    component.openCount = 74;

    fixture.detectChanges();

    expect(component.progressSummary).toBe('6/80 (8%)');
    expect(component.progressTooltip).toBe('Kodierfortschritt: 6/80 (8%) · Offen: 74');
    expect(fixture.nativeElement.querySelector('.progress-info').textContent).toContain('6/80 (8%)');
  });

  it('keeps general coding issue options and notes expanded by default and allows collapsing them', () => {
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false)
    });
    fixture.detectChanges();

    expect(component.isAuxiliarySectionExpanded).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.uncertain-codes-section .code-row')).toHaveLength(4);
    expect(fixture.nativeElement.querySelector('textarea')).toBeTruthy();

    component.toggleAuxiliarySection();
    fixture.detectChanges();

    expect(component.isAuxiliarySectionExpanded).toBe(false);
    expect(fixture.nativeElement.querySelector('.uncertain-codes-section')).toBeNull();
    expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  });

  it('expands and scrolls to a general code selected by numpad shortcut', () => {
    jest.useFakeTimers();
    const scrollSpy = jest.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollSpy;
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.isAuxiliarySectionExpanded = false;

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false)
    });
    jest.runOnlyPendingTimers();
    fixture.detectChanges();

    const event = new KeyboardEvent('keydown', { code: 'NumpadAdd' });
    const preventDefaultSpy = jest.spyOn(event, 'preventDefault');
    component.handleKeyboardEvent(event);
    fixture.detectChanges();
    jest.runOnlyPendingTimers();

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(component.isAuxiliarySectionExpanded).toBe(true);
    expect(component.selectedCodingIssueOption).toBe(-2);
    expect(fixture.nativeElement.querySelector('[data-code-selector-code-id="-2"].selected')).toBeTruthy();
    expect(scrollSpy).toHaveBeenCalled();

    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    jest.useRealTimers();
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

  it('shows review coder badges for codes selected by previous coders', () => {
    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      'code-selector': {
        'review-coders-tooltip': 'Von folgenden Kodierern vergeben: {{coders}}'
      }
    });
    translateService.setDefaultLang('de');
    translateService.use('de');

    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.reviewCodeSelections = [
      { code: 1, coderNames: ['Coder A', 'Coder B'] },
      { code: 2, coderNames: ['Coder C'] },
      { code: -2, coderNames: ['Coder D', 'Coder E'] }
    ];

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false)
    });
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.review-code-badge') as HTMLElement;
    const codeRow = fixture.nativeElement.querySelector('.code-row.has-review-code-selection') as HTMLElement;
    const issueBadge = fixture.nativeElement
      .querySelector('.uncertain-codes-section .review-code-badge') as HTMLElement;
    const issueRows = fixture.nativeElement
      .querySelectorAll('.uncertain-codes-section .code-row.has-review-code-selection') as NodeListOf<HTMLElement>;

    expect(component.hasReviewCodeSelection(1)).toBe(true);
    expect(component.getReviewCodeSelectionCount(1)).toBe(2);
    expect(component.hasReviewCodeSelection(2)).toBe(true);
    expect(component.getReviewCodeSelectionCount(-2)).toBe(2);
    expect(component.getReviewCodeSelectionCount(99)).toBe(0);
    expect(badge.textContent).toContain('2');
    expect(codeRow).toBeTruthy();
    expect(issueBadge.textContent).toContain('2');
    expect(issueRows).toHaveLength(1);
    expect(component.getCodingIssueOptionRowTooltip(
      component.codingIssueOptionCodes.find(item => item.id === -2)!
    )).toContain('Coder D, Coder E');

    component.onSelect(1);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.code-row.selected.has-review-code-selection')).toBeTruthy();
  });

  it('shows a stored legacy code without making it regularly selectable', () => {
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.preSelectedCodeId = 2;

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false),
      preSelectedCodeId: new SimpleChange(null, 2, false)
    });
    fixture.detectChanges();

    expect(component.regularCodes.map(code => code.id)).toEqual([1]);
    expect(component.selectedCode).toBeNull();
    expect(component.legacySelectedCode?.id).toBe(2);
    expect(fixture.nativeElement.querySelector('.legacy-code-row')).toBeTruthy();
  });

  it('shows a stored code missing from the current coding scheme', () => {
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.preSelectedCodeId = 99;
    component.unitsData = {
      ...interleavedUnitsData,
      currentUnitIndex: 0
    };
    const emitSpy = jest.spyOn(component.unitChanged, 'emit');

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false),
      preSelectedCodeId: new SimpleChange(null, 99, false)
    });
    fixture.detectChanges();
    component.nextUnit();

    expect(component.regularCodes.map(code => code.id)).toEqual([1]);
    expect(component.selectedCode).toBeNull();
    expect(component.legacySelectedCode).toEqual({
      id: 99,
      label: '',
      type: 'missingLegacyCode'
    });
    expect(fixture.nativeElement.querySelector('.legacy-code-row')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.legacy-code-note').textContent).toContain(
      'code-selector.legacy-code-missing-note'
    );
    expect(component.hasNextUnit()).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith(component.unitsData.units[1]);
  });

  it('counts a stored legacy code as current selection for navigation', () => {
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.preSelectedCodeId = 2;
    component.unitsData = {
      ...interleavedUnitsData,
      currentUnitIndex: 0
    };
    const emitSpy = jest.spyOn(component.unitChanged, 'emit');

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false),
      preSelectedCodeId: new SimpleChange(null, 2, false)
    });
    component.nextUnit();

    expect(component.hasNextUnit()).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith(component.unitsData.units[1]);
  });

  it('clears stored legacy code when selecting a current manual code', () => {
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.preSelectedCodeId = 2;

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false),
      preSelectedCodeId: new SimpleChange(null, 2, false)
    });
    component.onSelect(1);

    expect(component.legacySelectedCode).toBeNull();
    expect(component.selectedCode).toBe(1);
  });

  it('clears stored legacy code when selecting a standalone coding issue option', () => {
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.preSelectedCodeId = 2;
    const emitSpy = jest.spyOn(component.codeSelected, 'emit');

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false),
      preSelectedCodeId: new SimpleChange(null, 2, false)
    });
    component.onSelect(-2);

    expect(component.legacySelectedCode).toBeNull();
    expect(component.selectedCodingIssueOption).toBe(-2);
    expect(emitSpy).toHaveBeenCalledWith({
      variableId: 'VAR1',
      code: null,
      codingIssueOption: expect.objectContaining({ code: -2 })
    });
  });

  it('clears a coding issue option when a regular code resolves an issue review', () => {
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.clearCodingIssueOnRegularSelection = true;
    const emitSpy = jest.spyOn(component.codeSelected, 'emit');

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false)
    });
    component.onSelect(-1);
    component.onSelect(1);

    expect(component.selectedCode).toBe(1);
    expect(component.selectedCodingIssueOption).toBeNull();
    expect(emitSpy).toHaveBeenLastCalledWith({
      variableId: 'VAR1',
      code: mixedCodingScheme.variableCodings[0].codes[0],
      codingIssueOption: null
    });
  });

  it('clears stored legacy code when removing the selection', () => {
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.preSelectedCodeId = 2;
    const emitSpy = jest.spyOn(component.codeSelected, 'emit');

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false),
      preSelectedCodeId: new SimpleChange(null, 2, false)
    });
    component.deselectAll();

    expect(component.legacySelectedCode).toBeNull();
    expect(emitSpy).toHaveBeenCalledWith({
      variableId: 'VAR1',
      code: null,
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

  it('blocks nextUnit and focuses notes when new-code-needed has no comment', () => {
    jest.useFakeTimers();
    component.codingScheme = mixedCodingScheme;
    component.variableId = 'VAR1';
    component.unitsData = {
      ...interleavedUnitsData,
      currentUnitIndex: 0
    };
    const emitSpy = jest.spyOn(component.unitChanged, 'emit');

    component.ngOnChanges({
      codingScheme: new SimpleChange(null, mixedCodingScheme, false),
      variableId: new SimpleChange(null, 'VAR1', false)
    });
    jest.runOnlyPendingTimers();
    component.onSelect(-2);
    fixture.detectChanges();

    const notesTextarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    const focusSpy = jest.spyOn(notesTextarea, 'focus').mockImplementation(() => { });
    component.nextUnit();
    jest.runAllTimers();
    fixture.detectChanges();

    expect(emitSpy).not.toHaveBeenCalled();
    expect(component.newCodeCommentValidationError).toBe(true);
    expect(fixture.nativeElement.querySelector('.notes-validation-error').textContent).toContain(
      'code-selector.new-code-comment-required'
    );
    expect(focusSpy).toHaveBeenCalled();

    component.coderNotes = 'needs a new code';
    component.onNotesChanged();
    component.nextUnit();

    expect(component.newCodeCommentValidationError).toBe(false);
    expect(emitSpy).toHaveBeenCalledWith(component.unitsData.units[1]);
    jest.useRealTimers();
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

  it('shows compact variable chips for small alternating bundles', () => {
    component.showProgress = true;
    component.unitsData = {
      id: 1,
      name: 'job',
      currentUnitIndex: 0,
      units: [
        {
          id: 1,
          name: 'UNIT1',
          alias: 'UNIT1',
          bookletId: 0,
          variableId: 'V1',
          variableBundleId: 9,
          variableBundleCaseOrderingMode: 'alternating'
        },
        {
          id: 2,
          name: 'UNIT1',
          alias: 'UNIT1',
          bookletId: 0,
          variableId: 'V2',
          variableBundleId: 9,
          variableBundleCaseOrderingMode: 'alternating'
        }
      ]
    };

    fixture.detectChanges();

    expect(component.shouldShowBundleVariableChips).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('.variable-chip')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.variable-trigger-btn')).toBeNull();
  });

  it('marks auto-coded bundle variables as disabled chips', () => {
    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      coding: {
        'auto-coded-short': 'Auto',
        'auto-coded-bundle-variable-tooltip': 'Variable {{variableId}} ist in diesem Bundel automatisch kodiert.'
      }
    });
    translateService.setDefaultLang('de');
    translateService.use('de');

    component.showProgress = true;
    component.unitsData = {
      id: 1,
      name: 'job',
      currentUnitIndex: 0,
      units: [
        {
          id: 1,
          name: 'UNIT1',
          alias: 'UNIT1',
          bookletId: 0,
          variableId: 'V1',
          variableBundleId: 9,
          variableBundleCaseOrderingMode: 'alternating',
          variableBundleCaseVariables: [
            {
              unitName: 'UNIT1',
              variableId: 'V1',
              responseId: 1,
              statusV1: 8,
              isManualCodingUnit: true,
              isAutoCoded: false
            },
            {
              unitName: 'UNIT1',
              variableId: 'V2',
              responseId: 2,
              statusV1: 5,
              isManualCodingUnit: false,
              isAutoCoded: true
            }
          ]
        }
      ]
    };

    fixture.detectChanges();

    const chips = fixture.nativeElement.querySelectorAll('.variable-chip');
    expect(chips).toHaveLength(2);
    expect(chips[1].classList.contains('auto-coded')).toBe(true);
    expect(chips[1].disabled).toBe(true);
    expect(chips[1].textContent).toContain('Auto');
  });

  it('uses unit aliases for bundle chip navigation when bundle variables use unit names', () => {
    component.showProgress = true;
    component.unitsData = {
      id: 1,
      name: 'job',
      currentUnitIndex: 0,
      units: [
        {
          id: 1,
          name: 'UNIT_KEY',
          alias: 'UNIT_ALIAS',
          bookletId: 0,
          variableId: 'V1',
          variableBundleId: 9,
          variableBundleCaseOrderingMode: 'alternating',
          variableBundleCaseVariables: [
            {
              unitName: 'UNIT_KEY',
              variableId: 'V1',
              responseId: 1,
              statusV1: 8,
              isManualCodingUnit: true,
              isAutoCoded: false
            },
            {
              unitName: 'UNIT_KEY',
              variableId: 'V2',
              responseId: 2,
              statusV1: 8,
              isManualCodingUnit: true,
              isAutoCoded: false
            }
          ]
        },
        {
          id: 2,
          name: 'UNIT_KEY',
          alias: 'UNIT_ALIAS',
          bookletId: 0,
          variableId: 'V2',
          variableBundleId: 9,
          variableBundleCaseOrderingMode: 'alternating'
        }
      ]
    };
    component.codingService = {
      isUnitCoded: jest.fn().mockReturnValue(false)
    } as never;
    const emitSpy = jest.spyOn(component.unitChanged, 'emit');

    fixture.detectChanges();

    const chips = fixture.nativeElement.querySelectorAll('.variable-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0].classList.contains('active')).toBe(true);
    expect(component.activeBundleVariables.map(variable => variable.key)).toEqual([
      'UNIT_ALIAS::V1',
      'UNIT_ALIAS::V2'
    ]);

    chips[1].click();

    expect(emitSpy).toHaveBeenCalledWith(component.unitsData.units[1]);
  });

  it('navigates bundle chips within the current bundle case only', () => {
    component.showProgress = true;
    component.unitsData = {
      id: 1,
      name: 'job',
      currentUnitIndex: 2,
      units: [
        {
          id: 1,
          name: 'UNIT_KEY',
          alias: 'UNIT_ALIAS',
          bookletId: 0,
          testPerson: 'person-a@code-a@group@booklet',
          variableId: 'V1',
          variableBundleId: 9,
          variableBundleCaseOrderingMode: 'alternating'
        },
        {
          id: 2,
          name: 'UNIT_KEY',
          alias: 'UNIT_ALIAS',
          bookletId: 0,
          testPerson: 'person-a@code-a@group@booklet',
          variableId: 'V2',
          variableBundleId: 9,
          variableBundleCaseOrderingMode: 'alternating'
        },
        {
          id: 3,
          name: 'UNIT_KEY',
          alias: 'UNIT_ALIAS',
          bookletId: 0,
          testPerson: 'person-b@code-b@group@booklet',
          variableId: 'V1',
          variableBundleId: 9,
          variableBundleCaseOrderingMode: 'alternating',
          variableBundleCaseVariables: [
            {
              unitName: 'UNIT_KEY',
              variableId: 'V1',
              responseId: 3,
              statusV1: 8,
              isManualCodingUnit: true,
              isAutoCoded: false
            },
            {
              unitName: 'UNIT_KEY',
              variableId: 'V2',
              responseId: 4,
              statusV1: 8,
              isManualCodingUnit: true,
              isAutoCoded: false
            }
          ]
        },
        {
          id: 4,
          name: 'UNIT_KEY',
          alias: 'UNIT_ALIAS',
          bookletId: 0,
          testPerson: 'person-b@code-b@group@booklet',
          variableId: 'V2',
          variableBundleId: 9,
          variableBundleCaseOrderingMode: 'alternating'
        }
      ]
    };
    component.codingService = {
      isUnitCoded: jest.fn().mockReturnValue(false)
    } as never;
    const emitSpy = jest.spyOn(component.unitChanged, 'emit');

    fixture.detectChanges();

    const chips = fixture.nativeElement.querySelectorAll('.variable-chip');
    expect(chips).toHaveLength(2);

    chips[1].click();

    expect(emitSpy).toHaveBeenCalledWith(component.unitsData.units[3]);
  });

  it('does not create navigable bundle chips for missing manual units from the current case', () => {
    component.showProgress = true;
    component.unitsData = {
      id: 1,
      name: 'job',
      currentUnitIndex: 1,
      units: [
        {
          id: 1,
          name: 'UNIT_KEY',
          alias: 'UNIT_ALIAS',
          bookletId: 0,
          testPerson: 'person-a@code-a@group@booklet',
          variableId: 'V2',
          variableBundleId: 9,
          variableBundleCaseOrderingMode: 'alternating'
        },
        {
          id: 2,
          name: 'UNIT_KEY',
          alias: 'UNIT_ALIAS',
          bookletId: 0,
          testPerson: 'person-b@code-b@group@booklet',
          variableId: 'V1',
          variableBundleId: 9,
          variableBundleCaseOrderingMode: 'alternating',
          variableBundleCaseVariables: [
            {
              unitName: 'UNIT_KEY',
              variableId: 'V1',
              responseId: 2,
              statusV1: 8,
              isManualCodingUnit: true,
              isAutoCoded: false
            },
            {
              unitName: 'UNIT_KEY',
              variableId: 'V2',
              responseId: 3,
              statusV1: 8,
              isManualCodingUnit: true,
              isAutoCoded: false
            }
          ]
        }
      ]
    };

    fixture.detectChanges();

    expect(component.activeBundleVariables.map(variable => variable.variableId)).toEqual(['V1']);
    expect(component.shouldShowBundleVariableChips).toBe(false);
    expect(fixture.nativeElement.querySelectorAll('.variable-chip')).toHaveLength(0);
    expect(fixture.nativeElement.querySelector('.variable-trigger-btn')).toBeNull();
  });

  it('hides the pause button for completed job reviews', () => {
    component.showProgress = true;
    component.hasCodingJob = true;
    component.isCodingJobCompleted = false;
    component.isCompletedJobReview = true;

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.pause-button')).toBeNull();
  });

  it('disables and ignores pause while read-only', () => {
    const pauseSpy = jest.spyOn(component.pauseCodingJob, 'emit');
    component.showProgress = true;
    component.hasCodingJob = true;
    component.isCodingJobCompleted = false;
    component.isCompletedJobReview = false;
    component.isReadOnly = true;

    fixture.detectChanges();
    component.onPauseClick();

    const pauseButton = fixture.nativeElement.querySelector('.pause-button') as HTMLButtonElement;
    expect(pauseButton.disabled).toBe(true);
    expect(pauseSpy).not.toHaveBeenCalled();
  });

  it('disables and ignores navigation while navigation is blocked', () => {
    const unitChangedSpy = jest.spyOn(component.unitChanged, 'emit');
    const navigateSpy = jest.spyOn(component.openNavigateDialog, 'emit');
    component.showProgress = true;
    component.isNavigationDisabled = true;
    component.unitsData = {
      id: 1,
      name: 'Job',
      currentUnitIndex: 0,
      units: [
        {
          id: 1,
          name: 'UNIT_1',
          alias: 'UNIT_1',
          bookletId: 0,
          variableId: 'VAR1'
        },
        {
          id: 2,
          name: 'UNIT_2',
          alias: 'UNIT_2',
          bookletId: 0,
          variableId: 'VAR2'
        }
      ]
    };

    fixture.detectChanges();
    component.toggleVariablePanel();
    component.nextUnit();
    component.onNavigateClick();
    component.selectVariable('UNIT_2::VAR2');
    component.jumpToVariable('UNIT_2::VAR2');

    const nextButton = fixture.nativeElement.querySelector('.next-button') as HTMLButtonElement;
    const navigateButton = fixture.nativeElement.querySelector('.navigate-button') as HTMLButtonElement;
    const variableButton = fixture.nativeElement.querySelector('.variable-trigger-btn') as HTMLButtonElement;
    expect(nextButton.disabled).toBe(true);
    expect(navigateButton.disabled).toBe(true);
    expect(variableButton.disabled).toBe(true);
    expect(component.isVariablePanelOpen).toBe(false);
    expect(unitChangedSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
