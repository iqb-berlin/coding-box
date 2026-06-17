import {
  Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, SecurityContext, SimpleChanges,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ReviewCodeSelection, UnitsReplay, UnitsReplayUnit } from '../../../replay/services/units-replay.service';
import { ReplayCodingService } from '../../../replay/services/replay-coding.service';
import {
  Code,
  CodeSelectedEvent,
  CodingScheme,
  SelectableItem,
  CodingIssueDto,
  VariableCoding
} from '../../../models/coding-interfaces';
import { hasManualInstruction } from '../../utils/manual-coding.util';

@Component({
  selector: 'app-code-selector',
  standalone: true,
  imports: [CommonModule, FormsModule, MatListModule, MatButtonModule, MatDividerModule, MatFormFieldModule, MatInputModule, MatIconModule, MatTooltipModule, MatProgressBarModule, TranslateModule],
  templateUrl: './code-selector.component.html',
  styleUrls: ['./code-selector.component.css']
})
export class CodeSelectorComponent implements OnChanges {
  @Input() codingScheme!: string | CodingScheme;
  @Input() variableId!: string;
  @Input() preSelectedCodeId: number | null = null;
  @Input() preSelectedCodingIssueOptionId: number | null = null;
  @Input() coderNotes: string = '';
  @Input() showProgress: boolean = false;
  @Input() completedCount: number = 0;
  @Input() totalUnits: number = 0;
  @Input() progressPercentage: number = 0;
  @Input() openCount: number = 0;
  @Input() isCodingActive: boolean = false;
  @Input() hasCodingJob: boolean = false;
  @Input() isCodingJobCompleted: boolean = false;
  @Input() isCompletedJobReview: boolean = false;
  @Input() isPausingJob: boolean = false;
  @Input() unitsData: UnitsReplay | null = null;
  @Input() codingService!: ReplayCodingService;
  @Input() showScore: boolean = true;
  @Input() allowComments: boolean = true;
  @Input() suppressGeneralInstructions: boolean = false;
  @Input() isReadOnly: boolean = false;
  @Input() isNavigationDisabled: boolean = false;
  @Input() hasSaveError: boolean = false;
  @Input() clearCodingIssueOnRegularSelection: boolean = false;
  @Input() reviewCodeSelections: ReviewCodeSelection[] = [];

  @Output() codeSelected = new EventEmitter<CodeSelectedEvent>();
  @Output() notesChanged = new EventEmitter<string>();
  @Output() openNavigateDialog = new EventEmitter<void>();
  @Output() openCommentDialog = new EventEmitter<void>();
  @Output() openCodingJobs = new EventEmitter<void>();
  @Output() pauseCodingJob = new EventEmitter<void>();
  @Output() unitChanged = new EventEmitter<UnitsReplayUnit>();
  @ViewChild('variablePanel') variablePanel?: ElementRef<HTMLElement>;
  @ViewChild('notesTextarea') notesTextarea?: ElementRef<HTMLTextAreaElement>;

  selectableItems: SelectableItem[] = [];
  selectedCode: number | null = null;
  selectedCodingIssueOption: number | null = null;
  newCodeCommentValidationError = false;
  variableManualInstruction: string | null = null;
  legacySelectedCode: SelectableItem | null = null;
  isSupportSectionExpanded = true;
  private allRegularCodeItems: SelectableItem[] = [];
  private hasResolvedCodingScheme = false;
  private readonly codeAssignmentUncertainOptionId = -1;
  private readonly newCodeNeededOptionId = -2;
  private readonly commentBoundCodingIssueOptionIds = new Set<number>([
    this.codeAssignmentUncertainOptionId,
    this.newCodeNeededOptionId
  ]);

  private readonly safeHtmlCache = new Map<string, SafeHtml>();

  constructor(
    private sanitizer: DomSanitizer,
    private translateService: TranslateService,
    private elementRef: ElementRef<HTMLElement>
  ) { }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.isVariablePanelOpen && !this.elementRef.nativeElement.contains(event.target as Node | null)) {
      this.isVariablePanelOpen = false;
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.codingScheme || changes.variableId || changes.missings) {
      this.loadCodes();
    }
    if (changes.preSelectedCodeId || changes.preSelectedCodingIssueOptionId || changes.allowComments) {
      this.selectPreSelectedCode();
    }
  }

  private loadCodes(): void {
    if (!this.codingScheme || !this.variableId) {
      this.selectableItems = [];
      this.allRegularCodeItems = [];
      this.hasResolvedCodingScheme = false;
      this.variableManualInstruction = null;
      this.legacySelectedCode = null;
      return;
    }

    let scheme: CodingScheme;
    if (typeof this.codingScheme === 'string') {
      try {
        scheme = JSON.parse(this.codingScheme);
      } catch (e) {
        this.selectableItems = [];
        this.allRegularCodeItems = [];
        this.hasResolvedCodingScheme = false;
        this.variableManualInstruction = null;
        this.legacySelectedCode = null;
        return;
      }
    } else {
      scheme = this.codingScheme;
    }
    this.hasResolvedCodingScheme = true;

    const variableCoding = scheme.variableCodings.find(
      (v: VariableCoding) => v.alias === this.variableId || v.id === this.variableId
    );
    if (variableCoding) {
      this.variableManualInstruction = variableCoding.manualInstruction || null;
      this.allRegularCodeItems = variableCoding.codes
        .map((code: Code) => ({
          id: code.id,
          label: code.label,
          type: code.type,
          score: code.score,
          manualInstruction: code.manualInstruction,
          originalCode: code
        }));
      const codeItems: SelectableItem[] = this.allRegularCodeItems
        .filter((code: SelectableItem) => hasManualInstruction(code));

      const codingIssueOptions: SelectableItem[] = [
        {
          id: this.codeAssignmentUncertainOptionId,
          label: this.translateService.instant('code-selector.coding-issue-options.code-assignment-uncertain'),
          type: 'codingIssueOption'
        },
        {
          id: -3,
          label: `(mir) ${this.translateService.instant('code-selector.coding-issue-options.invalid-joke-answer')}`,
          type: 'codingIssueOption'
        },
        {
          id: -4,
          label: `(mci) ${this.translateService.instant('code-selector.coding-issue-options.technical-problems')} `,
          type: 'codingIssueOption'
        },
        {
          id: this.newCodeNeededOptionId,
          label: this.translateService.instant('code-selector.coding-issue-options.new-code-needed'),
          type: 'codingIssueOption'
        }
      ];

      this.selectableItems = [...codeItems, ...codingIssueOptions];
      setTimeout(() => this.selectPreSelectedCode(), 0);
    } else {
      this.selectableItems = [];
      this.allRegularCodeItems = [];
      this.variableManualInstruction = null;
      this.legacySelectedCode = null;
      setTimeout(() => this.selectPreSelectedCode(), 0);
    }
  }

  private selectPreSelectedCode(): void {
    this.selectedCode = null;
    this.selectedCodingIssueOption = null;
    this.legacySelectedCode = null;

    if (this.selectableItems.length === 0 && !this.hasResolvedCodingScheme) {
      return;
    }

    if (this.preSelectedCodeId !== null) {
      const preSelectedItem = this.selectableItems.find(item => item.id === this.preSelectedCodeId);
      if (preSelectedItem) {
        if (preSelectedItem.type === 'codingIssueOption') {
          if (this.isCodingIssueOptionAvailable(preSelectedItem)) {
            this.selectedCodingIssueOption = this.preSelectedCodeId;
          }
        } else {
          this.selectedCode = this.preSelectedCodeId;
        }
      } else {
        const legacyCodeInScheme = this.allRegularCodeItems.find(
          item => item.id === this.preSelectedCodeId && !hasManualInstruction(item)
        );
        this.legacySelectedCode = legacyCodeInScheme || this.createMissingLegacyCode(this.preSelectedCodeId);
      }
    }

    if (this.preSelectedCodingIssueOptionId !== null) {
      const codingIssueItem = this.selectableItems.find(item => item.id === this.preSelectedCodingIssueOptionId);
      if (
        codingIssueItem &&
        codingIssueItem.type === 'codingIssueOption' &&
        this.isCodingIssueOptionAvailable(codingIssueItem)
      ) {
        this.selectedCodingIssueOption = this.preSelectedCodingIssueOptionId;
        // Clear regular code selection when pre-selecting -3 or -4
        if (this.preSelectedCodingIssueOptionId === -3 || this.preSelectedCodingIssueOptionId === -4) {
          this.selectedCode = null;
          this.legacySelectedCode = null;
        }
      }
    }
  }

  getSafeHtml(instructions: string): SafeHtml {
    const html = instructions || '';
    const cached = this.safeHtmlCache.get(html);
    if (cached) return cached;

    const sanitized = this.sanitizer.sanitize(SecurityContext.HTML, html) || '';
    const trustedHtml = this.sanitizer.bypassSecurityTrustHtml(sanitized);
    this.safeHtmlCache.set(html, trustedHtml);
    return trustedHtml;
  }

  private createMissingLegacyCode(codeId: number): SelectableItem {
    return {
      id: codeId,
      label: '',
      type: 'missingLegacyCode'
    };
  }

  get legacyCodeNoteTranslationKey(): string {
    return this.legacySelectedCode?.type === 'missingLegacyCode' ?
      'code-selector.legacy-code-missing-note' :
      'code-selector.legacy-code-note';
  }

  private createCodeOrCodingIssueOption(item: SelectableItem): Code | CodingIssueDto {
    if (item.originalCode) {
      return item.originalCode;
    }
    if (item.type === 'codingIssueOption') {
      return {
        id: `uncertain-${item.id}`,
        label: item.label,
        description: '',
        code: item.id
      };
    }
    throw new Error(`Invalid item type for conversion: ${item.type}`);
  }

  onSelect(codeId: number): void {
    if (this.isReadOnly) return;
    const selectedItem = this.selectableItems.find(item => item.id === codeId);
    if (!selectedItem) return;

    // Prevent selection of regular codes when isRegularSelectionDisabled is true
    if (selectedItem.type !== 'codingIssueOption' && this.isRegularSelectionDisabled) return;

    if (selectedItem.type === 'codingIssueOption') {
      if (!this.isCodingIssueOptionAvailable(selectedItem) || this.isCodingIssueOptionDisabled(selectedItem)) return;
      this.selectedCodingIssueOption = codeId;
      this.legacySelectedCode = null;
      // Clear regular code selection when selecting -3 or -4
      if (codeId === -3 || codeId === -4) {
        this.selectedCode = null;
      }
    } else {
      this.selectedCode = codeId;
      this.legacySelectedCode = null;
      if (this.clearCodingIssueOnRegularSelection) {
        this.selectedCodingIssueOption = null;
      }
    }
    this.updateNewCodeCommentValidationState();
    const codeDto = this.selectedCode !== null ? this.createCodeOrCodingIssueOption(
      this.selectableItems.find(item => item.id === this.selectedCode)!
    ) : null;
    const codingIssueOption = this.selectedCodingIssueOption !== null ? this.createCodeOrCodingIssueOption(
      this.selectableItems.find(item => item.id === this.selectedCodingIssueOption)!
    ) as CodingIssueDto : null;
    this.codeSelected.emit({
      variableId: this.variableId,
      code: codeDto,
      codingIssueOption: codingIssueOption
    });
  }

  get regularCodes(): SelectableItem[] {
    return this.selectableItems.filter(item => item.type !== 'codingIssueOption');
  }

  hasReviewCodeSelection(codeId: number): boolean {
    return this.getReviewCodeSelectionCount(codeId) > 0;
  }

  getReviewCodeSelectionCount(codeId: number): number {
    return this.getReviewCodeSelection(codeId)?.coderNames.length || 0;
  }

  getReviewCodeSelectionTooltip(codeId: number): string {
    const selection = this.getReviewCodeSelection(codeId);
    if (!selection) {
      return '';
    }

    return this.translateService.instant('code-selector.review-coders-tooltip', {
      coders: selection.coderNames.join(', ')
    });
  }

  private getReviewCodeSelection(codeId: number): ReviewCodeSelection | undefined {
    return this.reviewCodeSelections.find(selection => (
      selection.code === codeId &&
      selection.coderNames.length > 0
    ));
  }

  get codingIssueOptionCodes(): SelectableItem[] {
    return this.selectableItems.filter(
      item => item.type === 'codingIssueOption' && this.isCodingIssueOptionAvailable(item)
    );
  }

  get hasVariableManualInstruction(): boolean {
    return !this.suppressGeneralInstructions && !!this.variableManualInstruction?.trim();
  }

  get isRegularSelectionDisabled(): boolean {
    return this.selectedCodingIssueOption === -3 || this.selectedCodingIssueOption === -4;
  }

  isCodingIssueOptionDisabled(item: SelectableItem): boolean {
    if (this.isReadOnly) return true;
    return item.id === this.codeAssignmentUncertainOptionId && this.selectedCode === null;
  }

  getCodingIssueOptionTooltip(item: SelectableItem): string {
    if (!this.isReadOnly && item.id === this.codeAssignmentUncertainOptionId && this.selectedCode === null) {
      return this.translateService.instant('code-selector.code-assignment-uncertain-requires-code');
    }

    return '';
  }

  getCodingIssueOptionRowTooltip(item: SelectableItem): string {
    return [
      this.getCodingIssueOptionTooltip(item),
      this.getReviewCodeSelectionTooltip(item.id)
    ].filter(Boolean).join(' - ');
  }

  private isCodingIssueOptionAvailable(item: SelectableItem): boolean {
    return this.allowComments || !this.commentBoundCodingIssueOptionIds.has(item.id);
  }

  private hasCurrentSelection(): boolean {
    return this.selectedCode !== null ||
      this.selectedCodingIssueOption !== null ||
      this.legacySelectedCode !== null;
  }

  deselectAll(): void {
    if (this.isReadOnly) return;
    this.selectedCode = null;
    this.selectedCodingIssueOption = null;
    this.legacySelectedCode = null;
    this.newCodeCommentValidationError = false;
    this.codeSelected.emit({
      variableId: this.variableId,
      code: null,
      codingIssueOption: null
    });
  }

  onNavigateClick(): void {
    if (this.isNavigationDisabled) return;
    this.openNavigateDialog.emit();
  }

  onCommentClick(): void {
    if (this.isReadOnly) return;
    this.openCommentDialog.emit();
  }

  onCodingJobsClick(): void {
    this.openCodingJobs.emit();
  }

  onPauseClick(): void {
    if (this.isReadOnly) return;
    this.pauseCodingJob.emit();
  }

  onNotesChanged(): void {
    if (this.isReadOnly) return;
    this.updateNewCodeCommentValidationState();
    this.notesChanged.emit(this.coderNotes);
  }

  canLeaveCurrentUnit(showValidationMessage = true): boolean {
    if (!this.requiresNewCodeComment() || this.hasNewCodeComment()) {
      this.newCodeCommentValidationError = false;
      return true;
    }

    if (showValidationMessage) {
      this.newCodeCommentValidationError = true;
      this.isSupportSectionExpanded = true;
      setTimeout(() => this.notesTextarea?.nativeElement.focus(), 0);
    }
    return false;
  }

  private requiresNewCodeComment(): boolean {
    return this.allowComments && this.selectedCodingIssueOption === this.newCodeNeededOptionId;
  }

  private hasNewCodeComment(): boolean {
    return this.coderNotes.trim().length > 0;
  }

  private updateNewCodeCommentValidationState(): void {
    if (!this.requiresNewCodeComment() || this.hasNewCodeComment()) {
      this.newCodeCommentValidationError = false;
    }
  }

  nextUnit(): void {
    const data = this.unitsData;
    if (!data) return;

    if (this.isNavigationDisabled) return;
    if (this.hasSaveError) return;
    if (!this.isReadOnly && !this.hasCurrentSelection()) return;
    if (!this.isReadOnly && !this.canLeaveCurrentUnit()) return;

    const currentIndex = data.currentUnitIndex;
    const nextIndex = currentIndex + 1;
    if (nextIndex < data.units.length) {
      this.unitChanged.emit(data.units[nextIndex]);
    }
  }

  previousUnit(): void {
    const data = this.unitsData;
    if (this.isNavigationDisabled) return;
    if (!data || !this.hasPreviousUnit()) return;

    const currentIndex = data.currentUnitIndex;
    const prevIndex = currentIndex - 1;
    if (prevIndex >= 0) {
      this.unitChanged.emit(data.units[prevIndex]);
    }
  }

  hasNextUnit(): boolean {
    const data = this.unitsData;
    if (this.isNavigationDisabled) return false;
    if (!data || !data.units.length) return false;

    const currentIndex = data.currentUnitIndex;
    const nextIndex = currentIndex + 1;
    const hasNext = nextIndex < data.units.length;
    if (this.isReadOnly) return hasNext;
    return hasNext && this.hasCurrentSelection() && !this.hasSaveError;
  }

  hasPreviousUnit(): boolean {
    const data = this.unitsData;
    if (this.isNavigationDisabled) return false;
    if (!data) return false;

    return data.currentUnitIndex > 0;
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    if (this.isReadOnly || this.selectableItems.length === 0) {
      return;
    }

    // Ignore if user is typing in an input/textarea
    // We check specifically for the tag name to avoid blocking shortcuts when focus is just on the body or a div
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      return;
    }

    let targetId: number | null = null;

    switch (event.code) {
      case 'NumpadDivide':
      case 'Slash': // Standard key fallback if desired, though user emphasized Numpad
        targetId = -1; // Code-Vergabe unsicher
        break;
      case 'NumpadMultiply':
        targetId = -3; // Ungültig (Spaßantwort)
        break;
      case 'NumpadSubtract':
      case 'Minus': // Standard key fallback
        targetId = -4; // Technische Probleme
        break;
      case 'NumpadAdd':
        targetId = -2; // Neuer Code nötig
        break;
      default:
        break;
    }

    if (targetId !== null) {
      const option = this.selectableItems.find(item => item.id === targetId);
      if (option && this.isCodingIssueOptionAvailable(option) && !this.isCodingIssueOptionDisabled(option)) {
        event.preventDefault(); // Prevent default browser action (e.g. quick find with '/')
        this.onSelect(targetId);
        this.scrollToCode(targetId);
      }
    }
  }

  getShortcutLabel(id: number): string {
    switch (id) {
      case -1: return '÷'; // Display for Divide
      case -3: return '×'; // Display for Multiply
      case -4: return '-';
      case -2: return '+';
      default: return '';
    }
  }

  get progressSummary(): string {
    return `${this.completedCount}/${this.totalUnits} (${this.progressPercentage}%)`;
  }

  get progressTooltip(): string {
    return this.translateService.instant('code-selector.progress-tooltip', {
      completed: this.completedCount,
      total: this.totalUnits,
      percentage: this.progressPercentage,
      open: this.openCount
    });
  }

  get supportSectionTitle(): string {
    if (!this.allowComments) {
      return this.translateService.instant('code-selector.general-codes');
    }

    return this.translateService.instant('code-selector.general-codes-and-notes');
  }

  toggleSupportSection(): void {
    this.isSupportSectionExpanded = !this.isSupportSectionExpanded;
  }

  scrollToCode(codeId: number): void {
    if (this.isSupportCode(codeId)) {
      this.isSupportSectionExpanded = true;
    }

    setTimeout(() => {
      const target = this.elementRef.nativeElement.querySelector<HTMLElement>(`[data-code-id="${codeId}"]`);
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, 0);
  }

  private isSupportCode(codeId: number): boolean {
    return this.codingIssueOptionCodes.some(item => item.id === codeId);
  }

  get totalNavigationUnits(): number {
    return this.unitsData?.units.length || 0;
  }

  get currentNavigationIndex(): number {
    return (this.unitsData?.currentUnitIndex || 0) + 1;
  }

  isVariablePanelOpen = false;

  toggleVariablePanel(): void {
    if (this.isNavigationDisabled) return;
    this.isVariablePanelOpen = !this.isVariablePanelOpen;
    if (this.isVariablePanelOpen) {
      setTimeout(() => this.focusCurrentVariableInPanel(), 0);
    }
  }

  closeVariablePanel(): void {
    this.isVariablePanelOpen = false;
  }

  selectVariable(key: string): void {
    if (this.isNavigationDisabled) return;
    this.isVariablePanelOpen = false;
    this.jumpToVariable(key);
  }

  private focusCurrentVariableInPanel(): void {
    const panel = this.variablePanel?.nativeElement;
    if (!panel) return;

    const activeItem = panel.querySelector<HTMLElement>('.variable-panel-item.active');
    const targetItem = activeItem || panel.querySelector<HTMLElement>('.variable-panel-item');
    if (!targetItem) return;

    targetItem.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    targetItem.focus({ preventScroll: true });
  }

  /** Returns coded/total/percentage for any unit+variable key. */
  getProgressForKey(key: string): { coded: number; total: number; percentage: number } {
    if (!this.unitsData?.units || !this.codingService) return { coded: 0, total: 0, percentage: 0 };
    const [unitName, variableId] = key.split('::');
    const units = this.unitsData.units.filter(
      u => (u.alias || u.name) === unitName && u.variableId === variableId
    );
    const total = units.length;
    const coded = units.filter(u => this.codingService.isUnitCoded(u)).length;
    const percentage = total > 0 ? Math.round((coded / total) * 100) : 0;
    return { coded, total, percentage };
  }

  /** Unique unit+variable combinations available in the current coding job, preserving order of first appearance. */
  get availableVariables(): { key: string; variableId: string; unitName: string }[] {
    if (!this.unitsData?.units) return [];
    const seen = new Set<string>();
    const result: { key: string; variableId: string; unitName: string }[] = [];
    for (const unit of this.unitsData.units) {
      if (unit.variableId) {
        const key = `${unit.alias || unit.name}::${unit.variableId}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({ key, variableId: unit.variableId, unitName: unit.alias || unit.name });
        }
      }
    }
    return result;
  }

  /** Composite key (unitName::variableId) for the unit currently being displayed. */
  get activeVariableKey(): string {
    if (!this.unitsData?.units) return '';
    const unit = this.unitsData.units[this.unitsData.currentUnitIndex];
    if (!unit?.variableId) return '';
    return `${unit.alias || unit.name}::${unit.variableId}`;
  }

  /** Progress (coded / total) for the unit+variable of the current unit. */
  get currentVariableProgress(): { coded: number; total: number; percentage: number } | null {
    if (!this.unitsData?.units || !this.codingService) return null;
    const currentUnit = this.unitsData.units[this.unitsData.currentUnitIndex];
    if (!currentUnit?.variableId) return null;
    const unitName = currentUnit.alias || currentUnit.name;
    const varId = currentUnit.variableId;
    // Count all units with the same unitName+variableId combo
    const variableUnits = this.unitsData.units.filter(
      u => (u.alias || u.name) === unitName && u.variableId === varId
    );
    const total = variableUnits.length;
    const coded = variableUnits.filter(u => this.codingService.isUnitCoded(u)).length;
    const percentage = total > 0 ? Math.round((coded / total) * 100) : 0;
    return { coded, total, percentage };
  }

  /**
   * Jump to the first uncoded unit for the given unit+variable key ("unitName::variableId").
   * Falls back to the first matching unit if all are coded.
   */
  jumpToVariable(key: string): void {
    if (this.isNavigationDisabled) return;
    if (!this.unitsData?.units) return;
    const [unitName, variableId] = key.split('::');
    const variableUnits = this.unitsData.units
      .map((unit, index) => ({ unit, index }))
      .filter(({ unit }) => (unit.alias || unit.name) === unitName && unit.variableId === variableId);
    if (variableUnits.length === 0) return;

    // Prefer first uncoded unit
    const firstUncoded = variableUnits.find(
      ({ unit }) => !this.codingService.isUnitCoded(unit)
    );
    const target = firstUncoded ?? variableUnits[0];
    this.unitChanged.emit(target.unit);
  }
}
