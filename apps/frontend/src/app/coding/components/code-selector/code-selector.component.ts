import {
  Component, EventEmitter, Input, OnChanges, Output, SimpleChanges
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
import { TranslateModule } from '@ngx-translate/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { UnitsReplay, UnitsReplayUnit } from '../../../services/units-replay.service';
import { ReplayCodingService } from '../../../services/replay-coding.service';
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
  constructor(private sanitizer: DomSanitizer) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.codingScheme || changes.variableId || changes.missings) {
      this.loadCodes();
    }
    if (changes.preSelectedCodeId) {
      this.selectPreSelectedCode();
    }
  }

  private loadCodes(): void {
    if (!this.codingScheme || !this.variableId) {
      this.selectableItems = [];
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

    const variableCoding = scheme.variableCodings.find((v: VariableCoding) => v.alias === this.variableId);
    if (variableCoding) {
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
          label: 'Code-Vergabe unsicher',
          type: 'codingIssueOption'
        },
        {
          id: -2,
          label: 'Neuer Code nötig',
          type: 'codingIssueOption'
        },
        {
          id: -3,
          label: 'Ungültig (Spaßantwort)',
          type: 'codingIssueOption'
        },
        {
          id: -4,
          label: 'Technische Probleme',
          type: 'codingIssueOption'
        }
      ];

      this.selectableItems = [...codeItems, ...codingIssueOptions];
      setTimeout(() => this.selectPreSelectedCode(), 0);
    } else {
      this.selectableItems = [];
    }
  }

  private selectPreSelectedCode(): void {
    this.selectedCode = null;
    this.selectedCodingIssueOption = null;
    if (this.preSelectedCodeId === null) {
      return;
    }
    if (this.selectableItems.length === 0) {
      return;
    }
    const preSelectedItem = this.selectableItems.find(item => item.id === this.preSelectedCodeId);
    if (preSelectedItem) {
      if (preSelectedItem.type === 'codingIssueOption') {
        this.selectedCodingIssueOption = this.preSelectedCodeId;
        this.codeSelected.emit({
          variableId: this.variableId,
          code: null,
          codingIssueOption: this.createCodeOrCodingIssueOption(preSelectedItem) as CodingIssueDto
        });
      } else {
        this.selectedCode = this.preSelectedCodeId;
        this.codeSelected.emit({
          variableId: this.variableId,
          code: this.createCodeOrCodingIssueOption(preSelectedItem)
        });
      }
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
    if (selectedItem.type === 'codingIssueOption') {
      this.selectedCodingIssueOption = codeId;
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

    const currentIndex = data.currentUnitIndex;
    const nextIndex = this.codingService.findNextUncodedUnitIndex(data, currentIndex + 1);
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

    const currentUnit = data.units[data.currentUnitIndex];
    if (!currentUnit) return false;

    const compositeKey = this.codingService.generateCompositeKey(
      currentUnit.testPerson || '',
      currentUnit.name,
      currentUnit.variableId || ''
    );

    const hasSelection = this.codingService.selectedCodes.has(compositeKey);
    const nextUncodedIndex = this.codingService.findNextUncodedUnitIndex(data, data.currentUnitIndex + 1);
    return hasSelection && nextUncodedIndex >= 0;
  }

  hasPreviousUnit(): boolean {
    const data = this.unitsData;
    if (!data) return false;

    return data.currentUnitIndex > 0;
  }

  get totalNavigationUnits(): number {
    return this.unitsData?.units.length || 0;
  }

  get currentNavigationIndex(): number {
    return (this.unitsData?.currentUnitIndex || 0) + 1;
  }
}
