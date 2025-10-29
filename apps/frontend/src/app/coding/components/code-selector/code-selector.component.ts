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
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export interface CodingScheme {
  variableCodings: VariableCoding[];
  version: string;
}

export interface VariableCoding {
  id: string;
  alias: string;
  label: string;
  sourceType: string;
  processing: string[];
  codeModel: string;
  codes: Code[];
  manualInstruction: string;
}

export interface Code {
  id: number;
  type: 'FULL_CREDIT' | 'RESIDUAL';
  label: string;
  score: number;
  ruleSetOperatorAnd: boolean;
  ruleSets: RuleSet[];
  manualInstruction: string;
}

export interface RuleSet {
  ruleOperatorAnd: boolean;
  rules: Rule[];
}

export interface Rule {
  method: string;
  parameters: string[];
}

export interface UncertainDto {
  id: string;
  label: string;
  description: string;
  code: number;
}

export interface CodeSelectedEvent {
  variableId: string;
  code: Code | UncertainDto | null;
}

export interface SelectableItem {
  id: number;
  label: string;
  type: string;
  score?: number;
  manualInstruction?: string;
  description?: string;
  originalCode?: Code;
}

@Component({
  selector: 'app-code-selector',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatListModule, MatButtonModule, MatDividerModule, MatFormFieldModule, MatInputModule, TranslateModule],
  templateUrl: './code-selector.component.html',
  styleUrls: ['./code-selector.component.css']
})
export class CodeSelectorComponent implements OnChanges {
  @Input() codingScheme!: string | CodingScheme;
  @Input() variableId!: string;
  @Input() preSelectedCodeId: number | null = null;
  @Input() missings: readonly unknown[] = [];
  @Input() isOpen: boolean = false;
  @Input() coderNotes: string = '';

  @Output() codeSelected = new EventEmitter<CodeSelectedEvent>();
  @Output() openChanged = new EventEmitter<boolean>();
  @Output() notesChanged = new EventEmitter<string>();

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

    const variableCoding = scheme.variableCodings.find(v => v.alias === this.variableId);
    if (variableCoding) {
      const codeItems: SelectableItem[] = variableCoding.codes.map(code => ({
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

  onNotesChanged(): void {
    this.notesChanged.emit(this.coderNotes);
  }
}
