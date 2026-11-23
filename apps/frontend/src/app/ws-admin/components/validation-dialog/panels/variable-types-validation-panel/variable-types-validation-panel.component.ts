import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { VariableTypeValidationService } from '../../../../services/validation';
import {
  INVALID_RESPONSE_PANEL_IMPORTS, InvalidResponsePanelConfig, InvalidResponseValidationPanel
} from '../invalid-response-validation-panel';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-variable-types-validation-panel',
  imports: [INVALID_RESPONSE_PANEL_IMPORTS],
  templateUrl: '../invalid-response-validation-panel.component.html',
  styleUrl: '../invalid-response-validation-panel.component.scss'
})
export class VariableTypesValidationPanelComponent extends InvalidResponseValidationPanel {
  protected readonly validationService = inject(VariableTypeValidationService);
  protected readonly config: InvalidResponsePanelConfig = {
    title: 'ui-text.variable-types-validation-panel.title',
    run: 'ui-text.variable-types-validation-panel.run',
    running: 'ui-text.variable-types-validation-panel.running',
    invalid: 'ui-text.variable-types-validation-panel.invalid-values-found',
    valid: 'ui-text.variable-types-validation-panel.no-invalid-values',
    description: 'Prüft, ob der Wert der Variable dem definierten Typ entspricht (string, integer, number, boolean, json).',
    whyText: 'Falsche Variablentypen können zu Fehlern bei der Datenverarbeitung, Auswertung und beim Export führen.',
    fixHint: 'Korrigieren Sie die Variablendefinitionen in der Unit.xml oder löschen Sie die ungültigen Antworten.',
    csvFilename: () => 'validierung-variablentypen.csv',
    includeExpectedType: true
  };
}
