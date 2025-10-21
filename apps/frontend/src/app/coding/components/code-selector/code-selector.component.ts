import {
  Component, EventEmitter, Input, OnChanges, Output, SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatRadioModule } from '@angular/material/radio';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
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

export interface CodeSelectedEvent {
  variableId: string;
  code: Code;
}

@Component({
  selector: 'app-code-selector',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatListModule, MatRadioModule, MatButtonModule],
  templateUrl: './code-selector.component.html',
  styleUrls: ['./code-selector.component.css']
})
export class CodeSelectorComponent implements OnChanges {
  @Input() codingScheme!: string | CodingScheme;
  @Input() variableId!: string;
  @Input() preSelectedCodeId: number | null = null;

  @Output() codeSelected = new EventEmitter<CodeSelectedEvent>();

  codes: Code[] = [];
  selectedCode: number | null = null;

  constructor(private sanitizer: DomSanitizer) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.codingScheme || changes.variableId) {
      this.loadCodes();
    }
    if (changes.preSelectedCodeId) {
      this.selectPreSelectedCode();
    }
  }

  private loadCodes(): void {
    if (!this.codingScheme || !this.variableId) {
      this.codes = [];
      return;
    }

    let scheme: CodingScheme;
    if (typeof this.codingScheme === 'string') {
      try {
        scheme = JSON.parse(this.codingScheme);
      } catch (e) {
        this.codes = [];
        return;
      }
    } else {
      scheme = this.codingScheme;
    }

    const variableCoding = scheme.variableCodings.find(v => v.alias === this.variableId);
    if (variableCoding) {
      this.codes = variableCoding.codes;
      setTimeout(() => this.selectPreSelectedCode(), 0);
    } else {
      this.codes = [];
    }
  }

  private selectPreSelectedCode(): void {
    this.selectedCode = null;
    if (this.preSelectedCodeId === null) {
      return;
    }
    if (this.codes.length === 0) {
      return;
    }
    const preSelectedCode = this.codes.find(c => c.id === this.preSelectedCodeId);
    if (preSelectedCode) {
      this.selectedCode = this.preSelectedCodeId;
      this.codeSelected.emit({
        variableId: this.variableId,
        code: preSelectedCode
      });
    }
  }

  getSafeHtml(instructions: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(instructions);
  }

  onSelect(codeId: number): void {
    this.selectedCode = codeId;
    const selectedCode = this.codes.find(c => c.id === codeId);
    if (selectedCode) {
      this.codeSelected.emit({
        variableId: this.variableId,
        code: selectedCode
      });
    }
  }

  onSelectionChange(): void {
    // This method is called whenever the selection changes
    // Selection changes are handled by onSelect() method
  }
}
