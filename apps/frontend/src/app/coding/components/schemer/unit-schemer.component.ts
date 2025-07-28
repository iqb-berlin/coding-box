import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { UnitScheme } from './unit-scheme.interface';
import { SchemerConfig } from './schemer-config.interface';
import {
  VosReadNotification,
  VosStartCommand
} from './message-types.interface';
import { PostMessageService } from '../../../services/post-message.service';
import { SchemerMessage } from '../../../services/post-message-types';

@Component({
  selector: 'unit-schemer-standalone',
  templateUrl: './unit-schemer.component.html',
  styleUrls: ['./unit-schemer.component.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class StandaloneUnitSchemerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('hostingIframe') hostingIframe!: ElementRef;
  @Input() schemerId = '';
  @Input() schemerHtml = '';
  @Input() unitScheme: UnitScheme = {
    scheme: '',
    schemeType: ''
  };

  @Input() schemerConfig: SchemerConfig = {
    definitionReportPolicy: 'eager',
    role: 'editor'
  };

  @Output() schemeChanged = new EventEmitter<UnitScheme>();
  @Output() error = new EventEmitter<string>();
  @Output() ready = new EventEmitter<void>();
  @Output() readNotification = new EventEmitter<VosReadNotification>();

  private iFrameElement: HTMLIFrameElement | undefined;
  private sessionId = '';
  private destroy$ = new Subject<void>();
  message = '';

  constructor(private postMessageService: PostMessageService) {}

  ngAfterViewInit(): void {
    this.iFrameElement = this.hostingIframe.nativeElement;

    this.subscribeToSchemerMessages();

    if (this.schemerHtml) {
      this.setupSchemerIFrame(this.schemerHtml);
    } else if (this.schemerId) {
      this.error.emit(`Schemer HTML content not provided for ID: ${this.schemerId}`);
    } else {
      this.error.emit('Neither schemer ID nor HTML content provided');
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
              schemeType: event.message.codingSchemeType || this.unitScheme.schemeType,
              variables: this.unitScheme.variables
            };
            this.unitScheme = updatedScheme;
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
            this.message = event.message.message;
            // Clear the message after a few seconds
            setTimeout(() => {
              this.message = '';
            }, 3000);
          }
        }
      });
  }

  sendUnitScheme(): void {
    if (this.iFrameElement?.contentWindow) {
      const variables = this.unitScheme.variables || [];
      const message: VosStartCommand = {
        type: 'vosStartCommand',
        sessionId: this.sessionId,
        schemerConfig: this.schemerConfig,
        codingScheme: this.unitScheme.scheme || '',
        codingSchemeType: this.unitScheme.schemeType || '',
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
    this.destroy$.next();
    this.destroy$.complete();
  }
}
