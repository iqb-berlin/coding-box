import {
  AfterViewInit, Component, ElementRef, OnDestroy, signal, input, output, viewChild, linkedSignal, ChangeDetectionStrategy, inject
} from '@angular/core';

import { Subject, takeUntil } from 'rxjs';
import { UnitScheme } from './unit-scheme.interface';
import { SchemerConfig } from './schemer-config.interface';
import {
  VosReadNotification,
  VosStartCommand
} from './message-types.interface';
import { PostMessageService } from '../../../core/services/post-message.service';
import { SchemerMessage } from '../../../core/services/post-message-types';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-unit-schemer',
  templateUrl: './unit-schemer.component.html',
  styleUrls: ['./unit-schemer.component.scss'],
  standalone: true,
  imports: []
})
export class StandaloneUnitSchemerComponent implements AfterViewInit, OnDestroy {
  private postMessageService = inject(PostMessageService);

  readonly hostingIframe = viewChild.required<ElementRef>('hostingIframe');
  readonly schemerId = input('');
  readonly schemerHtml = input('');
  readonly unitScheme = input<UnitScheme>({
    scheme: '',
    schemeType: ''
  });

  private readonly currentUnitScheme = linkedSignal(() => this.unitScheme());

  readonly schemerConfig = input<SchemerConfig>({
    definitionReportPolicy: 'eager',
    role: 'editor'
  });

  readonly schemeChanged = output<UnitScheme>();
  readonly schemerError = output<string>();
  readonly ready = output<void>();
  readonly readNotification = output<VosReadNotification>();

  private iFrameElement: HTMLIFrameElement | undefined;
  private sessionId = '';
  private destroy$ = new Subject<void>();
  private messageTimeout?: ReturnType<typeof setTimeout>;
  readonly message = signal('');

  ngAfterViewInit(): void {
    this.iFrameElement = this.hostingIframe().nativeElement;

    this.subscribeToSchemerMessages();

    const schemerHtml = this.schemerHtml();
    const schemerId = this.schemerId();
    if (schemerHtml) {
      this.setupSchemerIFrame(schemerHtml);
    } else if (schemerId) {
      this.schemerError.emit(`Schemer HTML content not provided for ID: ${schemerId}`);
    } else {
      this.schemerError.emit('Neither schemer ID nor HTML content provided');
    }
  }

  private subscribeToSchemerMessages(): void {
    this.postMessageService.getMessages<SchemerMessage>('vosReadyNotification')
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        if (event.source === this.iFrameElement?.contentWindow) {
          this.sessionId = this.postMessageService.generateSessionId();
          this.sendUnitScheme();
          this.ready.emit();
        }
      });

    this.postMessageService.getMessages<SchemerMessage>('vosSchemeChangedNotification')
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        if (event.source === this.iFrameElement?.contentWindow && event.message.sessionId === this.sessionId) {
          if (event.message.codingScheme) {
            const updatedScheme: UnitScheme = {
              scheme: event.message.codingScheme,
              schemeType: event.message.codingSchemeType || this.currentUnitScheme().schemeType,
              variables: this.currentUnitScheme().variables
            };
            this.currentUnitScheme.set(updatedScheme);
            this.schemeChanged.emit(updatedScheme);
          }
        }
      });

    this.postMessageService.getMessages<SchemerMessage>('vosReadNotification')
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        if (event.source === this.iFrameElement?.contentWindow && event.message.sessionId === this.sessionId) {
          this.readNotification.emit(event.message as VosReadNotification);

          // Optionally display a message in the component
          if (event.message.message) {
            this.message.set(event.message.message);
            clearTimeout(this.messageTimeout);
            // Clear the message after a few seconds
            this.messageTimeout = setTimeout(() => {
              this.message.set('');
              this.messageTimeout = undefined;
            }, 3000);
          }
        }
      });
  }

  sendUnitScheme(): void {
    if (this.iFrameElement?.contentWindow) {
      const variables = this.currentUnitScheme().variables || [];
      const message: VosStartCommand = {
        type: 'vosStartCommand',
        sessionId: this.sessionId,
        schemerConfig: this.schemerConfig(),
        codingScheme: this.currentUnitScheme().scheme || '',
        codingSchemeType: this.currentUnitScheme().schemeType || '',
        variables: variables
      };

      this.postMessageService.sendMessageToIframe(message, this.iFrameElement);
    }
  }

  private setupSchemerIFrame(schemerHtml: string): void {
    if (this.iFrameElement && this.iFrameElement.parentElement) {
      this.iFrameElement.srcdoc = schemerHtml;
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.messageTimeout);
    this.destroy$.next();
    this.destroy$.complete();
  }
}
