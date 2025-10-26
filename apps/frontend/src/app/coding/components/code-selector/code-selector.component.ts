import {
  Component, EventEmitter, Input, OnChanges, Output, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatRadioModule } from '@angular/material/radio';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MissingDto } from '../../../../../../../api-dto/coding/missings-profiles.dto';

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

export interface CodeSelectedEvent {
  variableId: string;
  code: Code | MissingDto;
}

export interface SelectableItem {
  id: number;
  label: string;
  type: string;
  score?: number;
  manualInstruction?: string;
  description?: string;
  isMissing: boolean;
  originalCode?: Code;
  originalMissing?: MissingDto;
}

@Component({
  selector: 'app-code-selector',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatListModule, MatRadioModule, MatButtonModule, MatCheckboxModule, TranslateModule],
  templateUrl: './code-selector.component.html',
  styleUrls: ['./code-selector.component.css']
})
export class CodeSelectorComponent implements OnChanges {
  @Input() codingScheme!: string | CodingScheme;
  @Input() variableId!: string;
  @Input() preSelectedCodeId: number | null = null;
  @Input() missings: MissingDto[] = [];
  @Input() isOpen: boolean = false;

  @Output() codeSelected = new EventEmitter<CodeSelectedEvent>();
  @Output() openChanged = new EventEmitter<boolean>();

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
        isMissing: false,
        originalCode: code
      }));

      const missingItems: SelectableItem[] = this.missings.map(missing => ({
        id: missing.code,
        label: missing.label,
        type: 'MISSING',
        description: missing.description,
        isMissing: true,
        originalMissing: missing
      }));

      this.selectableItems = [...codeItems, ...missingItems];
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
        code: preSelectedItem.isMissing ? preSelectedItem.originalMissing! : preSelectedItem.originalCode!
      });
    }
  }

  getSafeHtml(instructions: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(instructions);
  }

  onSelect(codeId: number): void {
    this.selectedCode = codeId;
    const selectedItem = this.selectableItems.find(item => item.id === codeId);
    if (selectedItem) {
      this.codeSelected.emit({
        variableId: this.variableId,
        code: selectedItem.isMissing ? selectedItem.originalMissing! : selectedItem.originalCode!
      });
    }
  }

  onOpenChanged(): void {
    if (this.isOpen) {
      this.selectedCode = null;
    }
    this.openChanged.emit(this.isOpen);
  }
}
