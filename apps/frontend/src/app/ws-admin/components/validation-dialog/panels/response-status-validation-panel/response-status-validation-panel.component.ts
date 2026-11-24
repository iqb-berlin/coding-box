import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ResponseStatusValidationService } from '../../../../services/validation';
import {
  INVALID_RESPONSE_PANEL_IMPORTS, InvalidResponsePanelConfig, InvalidResponseValidationPanel
} from '../invalid-response-validation-panel';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-response-status-validation-panel',
  imports: [INVALID_RESPONSE_PANEL_IMPORTS],
  templateUrl: '../invalid-response-validation-panel.component.html',
  styleUrl: '../invalid-response-validation-panel.component.scss'
})
export class ResponseStatusValidationPanelComponent extends InvalidResponseValidationPanel {
  protected readonly validationService = inject(ResponseStatusValidationService);
  protected readonly config: InvalidResponsePanelConfig = {
    title: 'ui-text.response-status-validation-panel.title',
    run: 'ui-text.response-status-validation-panel.run',
    running: 'ui-text.response-status-validation-panel.running',
    formatInvalidResult: count => this.uiTranslate('ui-text.response-status-validation-panel.invalid-statuses-found', { value1: count }),
    valid: 'ui-text.response-status-validation-panel.no-invalid-statuses',
    description: 'Prüft, ob der Status der Antwort gültig ist (gemäß Unit.xml).',
    whyText: 'Ungültige Antwortstatus können zu Problemen bei der Datenauswertung und beim Export führen.',
    fixHint: 'Korrigieren Sie die Status-Definitionen in der Unit.xml oder löschen Sie die ungültigen Antworten.',
    csvFilename: () => 'validierung-antwortstatus.csv'
  };
}
