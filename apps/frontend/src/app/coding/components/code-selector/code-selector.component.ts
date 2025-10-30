import {
  Component, EventEmitter, Input, OnChanges, Output, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { UnitsReplay, UnitsReplayUnit } from '../../../services/units-replay.service';
import { ReplayCodingService } from '../../../services/replay-coding.service';
import {
  Code,
  CodeSelectedEvent,
  CodingScheme,
  SelectableItem,
  UncertainDto,
  VariableCoding
} from '../../../models/coding-interfaces';

@Component({
  selector: 'app-code-selector',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatListModule, MatButtonModule, MatDividerModule, MatFormFieldModule, MatInputModule, MatIconModule, MatTooltipModule, MatProgressBarModule, TranslateModule],
  templateUrl: './code-selector.component.html',
  styleUrls: ['./code-selector.component.css']
})
export class CodeSelectorComponent implements OnChanges {
  @Input() codingScheme!: string | CodingScheme;
  @Input() variableId!: string;
  @Input() preSelectedCodeId: number | null = null;
  @Input() isOpen: boolean = false;
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

  @Output() codeSelected = new EventEmitter<CodeSelectedEvent>();
  @Output() openChanged = new EventEmitter<boolean>();
  @Output() notesChanged = new EventEmitter<string>();
  @Output() openNavigateDialog = new EventEmitter<void>();
  @Output() openCommentDialog = new EventEmitter<void>();
  @Output() pauseCodingJob = new EventEmitter<void>();
  @Output() unitChanged = new EventEmitter<UnitsReplayUnit>();

  selectableItems: SelectableItem[] = [];
  selectedCode: number | null = null;
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

      const uncertainOptions: SelectableItem[] = [
        {
          id: -1,
          label: 'Code-Vergabe unsicher',
          type: 'UNCERTAIN'
        },
        {
          id: -2,
          label: 'Neuer Code nötig',
          type: 'UNCERTAIN'
        },
        {
          id: -3,
          label: 'Ungültig (Spaßantwort)',
          type: 'UNCERTAIN'
        },
        {
          id: -4,
          label: 'Technische Probleme',
          type: 'UNCERTAIN'
        }
      ];

      this.selectableItems = [...codeItems, ...uncertainOptions];
      setTimeout(() => this.selectPreSelectedCode(), 0);
    } else {
      this.selectableItems = [];
    }
  }

  private selectPreSelectedCode(): void {
    this.selectedCode = null;
    if (this.preSelectedCodeId === null) {
      return;
    }
    if (this.selectableItems.length === 0) {
      return;
    }
    const preSelectedItem = this.selectableItems.find(item => item.id === this.preSelectedCodeId);
    if (preSelectedItem) {
      this.selectedCode = this.preSelectedCodeId;
      this.codeSelected.emit({
        variableId: this.variableId,
        code: this.createCodeOrUncertainDto(preSelectedItem)
      });
    }
  }

  getSafeHtml(instructions: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(instructions);
  }

  private createCodeOrUncertainDto(item: SelectableItem): Code | UncertainDto {
    if (item.originalCode) {
      return item.originalCode;
    }
    if (item.type === 'UNCERTAIN') {
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
    this.selectedCode = codeId;
    const selectedItem = this.selectableItems.find(item => item.id === codeId);
    if (selectedItem) {
      this.codeSelected.emit({
        variableId: this.variableId,
        code: this.createCodeOrUncertainDto(selectedItem)
      });

      if (selectedItem.type === 'UNCERTAIN') {
        this.openChanged.emit(true);
      }
    }
  }

  get regularCodes(): SelectableItem[] {
    return this.selectableItems.filter(item => item.type !== 'UNCERTAIN');
  }

  get uncertainCodes(): SelectableItem[] {
    return this.selectableItems.filter(item => item.type === 'UNCERTAIN');
  }

  deselectAll(): void {
    this.selectedCode = null;
    this.codeSelected.emit({
      variableId: this.variableId,
      code: null
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

    const hasSelection = this.codingService.selectedCodes.has(compositeKey) ||
                        this.codingService.openSelections.has(compositeKey);
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
