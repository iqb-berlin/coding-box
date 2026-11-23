import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { VariableValidationService } from '../../../../services/validation';
import {
  INVALID_RESPONSE_PANEL_IMPORTS, InvalidResponsePanelConfig, InvalidResponseValidationPanel
} from '../invalid-response-validation-panel';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-variables-validation-panel',
  imports: [INVALID_RESPONSE_PANEL_IMPORTS],
  templateUrl: '../invalid-response-validation-panel.component.html',
  styleUrl: '../invalid-response-validation-panel.component.scss'
})
export class VariablesValidationPanelComponent extends InvalidResponseValidationPanel {
  protected readonly validationService = inject(VariableValidationService);
  protected readonly config: InvalidResponsePanelConfig = {
    title: 'ui-text.variables-validation-panel.title',
    run: 'ui-text.variables-validation-panel.run',
    running: 'ui-text.variables-validation-panel.running',
    formatInvalidResult: count => this.uiTranslate('ui-text.variables-validation-panel.invalid-variables-found', { value1: count }),
    valid: 'ui-text.variables-validation-panel.no-invalid-variables',
    description: 'Prüft, ob die Variable in der Unit.xml definiert ist.',
    whyText: 'Undefinierte Variablen können nicht korrekt verarbeitet oder exportiert werden und deuten auf Inkonsistenzen zwischen Unit-Definitionen und Antwortdaten hin.',
    fixHint: 'Aktualisieren Sie die Unit.xml Dateien, um die fehlenden Variablen zu definieren, oder löschen Sie die ungültigen Antworten.',
    csvFilename: () => this.uiTranslate('ui-text.variables-validation-panel.csv-filename'),
    responseIdBeforeReason: true
  };
}
