import {
  Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges
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
import { UnitsReplay, UnitsReplayUnit } from '../../../replay/services/units-replay.service';
import { ReplayCodingService } from '../../../replay/services/replay-coding.service';
import {
  Code,
  CodeSelectedEvent,
  CodingScheme,
  SelectableItem,
  CodingIssueDto,
  VariableCoding
} from '../../../models/coding-interfaces';

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
  @Input() isPausingJob: boolean = false;
  @Input() unitsData: UnitsReplay | null = null;
  @Input() codingService!: ReplayCodingService;
  @Input() showScore: boolean = true;
  @Input() allowComments: boolean = true;
  @Input() suppressGeneralInstructions: boolean = false;
  @Input() isReadOnly: boolean = false;

  @Output() codeSelected = new EventEmitter<CodeSelectedEvent>();
  @Output() notesChanged = new EventEmitter<string>();
  @Output() openNavigateDialog = new EventEmitter<void>();
  @Output() openCommentDialog = new EventEmitter<void>();
  @Output() pauseCodingJob = new EventEmitter<void>();
  @Output() unitChanged = new EventEmitter<UnitsReplayUnit>();

  selectableItems: SelectableItem[] = [];
  selectedCode: number | null = null;
  selectedCodingIssueOption: number | null = null;
  variableManualInstruction: string | null = null;
  constructor(private sanitizer: DomSanitizer, private translateService: TranslateService) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.codingScheme || changes.variableId || changes.missings) {
      this.loadCodes();
    }
    if (changes.preSelectedCodeId || changes.preSelectedCodingIssueOptionId) {
      this.selectPreSelectedCode();
    }
  }

  private loadCodes(): void {
    if (!this.codingScheme || !this.variableId) {
      this.selectableItems = [];
      this.variableManualInstruction = null;
      return;
    }

    let scheme: CodingScheme;
    if (typeof this.codingScheme === 'string') {
      try {
        scheme = JSON.parse(this.codingScheme);
      } catch (e) {
        this.selectableItems = [];
        return;
      }
    } else {
      scheme = this.codingScheme;
    }

    const variableCoding = scheme.variableCodings.find(
      (v: VariableCoding) => v.alias === this.variableId || v.id === this.variableId
    );
    if (variableCoding) {
      this.variableManualInstruction = variableCoding.manualInstruction || null;
      const codeItems: SelectableItem[] = variableCoding.codes.map((code: Code) => ({
        id: code.id,
        label: code.label,
        type: code.type,
        score: code.score,
        manualInstruction: code.manualInstruction,
        originalCode: code
      }));

      const codingIssueOptions: SelectableItem[] = [
        {
          id: -1,
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
          id: -2,
          label: this.translateService.instant('code-selector.coding-issue-options.new-code-needed'),
          type: 'codingIssueOption'
        }
      ];

      this.selectableItems = [...codeItems, ...codingIssueOptions];
      setTimeout(() => this.selectPreSelectedCode(), 0);
    } else {
      this.selectableItems = [];
      this.variableManualInstruction = null;
    }
  }

  private selectPreSelectedCode(): void {
    this.selectedCode = null;
    this.selectedCodingIssueOption = null;

    if (this.selectableItems.length === 0) {
      return;
    }

    if (this.preSelectedCodeId !== null) {
      const preSelectedItem = this.selectableItems.find(item => item.id === this.preSelectedCodeId);
      if (preSelectedItem) {
        if (preSelectedItem.type === 'codingIssueOption') {
          this.selectedCodingIssueOption = this.preSelectedCodeId;
        } else {
          this.selectedCode = this.preSelectedCodeId;
        }
      }
    }

    if (this.preSelectedCodingIssueOptionId !== null) {
      const codingIssueItem = this.selectableItems.find(item => item.id === this.preSelectedCodingIssueOptionId);
      if (codingIssueItem && codingIssueItem.type === 'codingIssueOption') {
        this.selectedCodingIssueOption = this.preSelectedCodingIssueOptionId;
        // Clear regular code selection when pre-selecting -3 or -4
        if (this.preSelectedCodingIssueOptionId === -3 || this.preSelectedCodingIssueOptionId === -4) {
          this.selectedCode = null;
        }
      }
    }

    const codeDto = this.selectedCode !== null ? this.createCodeOrCodingIssueOption(
      this.selectableItems.find(item => item.id === this.selectedCode)!
    ) : null;

    const codingIssueOption = this.selectedCodingIssueOption !== null ? this.createCodeOrCodingIssueOption(
      this.selectableItems.find(item => item.id === this.selectedCodingIssueOption)!
    ) as CodingIssueDto : null;

    if (codeDto || codingIssueOption) {
      this.codeSelected.emit({
        variableId: this.variableId,
        code: codeDto,
        codingIssueOption: codingIssueOption
      });
    }
  }

  getSafeHtml(instructions: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(instructions);
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
      this.selectedCodingIssueOption = codeId;
      // Clear regular code selection when selecting -3 or -4
      if (codeId === -3 || codeId === -4) {
        this.selectedCode = null;
      }
    } else {
      this.selectedCode = codeId;
    }
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

  get codingIssueOptionCodes(): SelectableItem[] {
    return this.selectableItems.filter(item => item.type === 'codingIssueOption');
  }

  get isRegularSelectionDisabled(): boolean {
    return this.selectedCodingIssueOption === -3 || this.selectedCodingIssueOption === -4;
  }

  private hasCurrentSelection(): boolean {
    return this.selectedCode !== null || this.selectedCodingIssueOption !== null;
  }

  deselectAll(): void {
    this.selectedCode = null;
    this.selectedCodingIssueOption = null;
    this.codeSelected.emit({
      variableId: this.variableId,
      code: null,
      codingIssueOption: null
    });
  }

  onNavigateClick(): void {
    this.openNavigateDialog.emit();
  }

  onCommentClick(): void {
    this.openCommentDialog.emit();
  }

  onPauseClick(): void {
    this.pauseCodingJob.emit();
  }

  onNotesChanged(): void {
    this.notesChanged.emit(this.coderNotes);
  }

  nextUnit(): void {
    const data = this.unitsData;
    if (!data) {
      return;
    }

    if (!this.isReadOnly && !this.hasCurrentSelection()) {
      return;
    }

    const currentIndex = data.currentUnitIndex;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= 0 && nextIndex < data.units.length) {
      this.unitChanged.emit(data.units[nextIndex]);
    }
  }

  previousUnit(): void {
    const data = this.unitsData;
    if (!data || !this.hasPreviousUnit()) {
      return;
    }

    const prevIndex = data.currentUnitIndex - 1;
    if (prevIndex >= 0) {
      const prevUnit = data.units[prevIndex];
      this.unitChanged.emit(prevUnit);
    }
  }

  hasNextUnit(): boolean {
    const data = this.unitsData;
    if (!data || !data.units.length) return false;

    const nextIndex = data.currentUnitIndex + 1;
    const hasNext = nextIndex < data.units.length;

    if (this.isReadOnly) {
      return hasNext;
    }

    return hasNext && this.hasCurrentSelection();
  }

  hasPreviousUnit(): boolean {
    const data = this.unitsData;
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
    }

    if (targetId !== null) {
      const optionExists = this.selectableItems.some(item => item.id === targetId);
      if (optionExists) {
        event.preventDefault(); // Prevent default browser action (e.g. quick find with '/')
        this.onSelect(targetId);
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

  get totalNavigationUnits(): number {
    return this.unitsData?.units.length || 0;
  }

  get currentNavigationIndex(): number {
    return (this.unitsData?.currentUnitIndex || 0) + 1;
  }
}
