import { Injectable, NgZone } from '@angular/core';
import {
  Observable,
  Subject,
  filter,
  map
} from 'rxjs';

export interface PostMessage {
  type: string;
  sessionId?: string;
  data?: Record<string, unknown>;
}

@Injectable({
  providedIn: 'root'
})
export class PostMessageService {
  private readonly messageSubject: Subject<{ message: PostMessage, source: MessageEventSource | null }> =
    new Subject<{ message: PostMessage, source: MessageEventSource | null }>();

  readonly messages$: Observable<{ message: PostMessage, source: MessageEventSource | null }> =
    this.messageSubject.asObservable();

  constructor(private readonly zone: NgZone) {
    this.setupMessageListener();
  }

  private setupMessageListener(): void {
    // Use NgZone.runOutsideAngular to avoid unnecessary change detection
    this.zone.runOutsideAngular(() => {
      window.addEventListener('message', (event: MessageEvent) => {
        // Run inside Angular zone when a message is received
        this.zone.run(() => {
          try {
            const message = event.data as PostMessage;
            this.messageSubject.next({
              message,
              source: event.source
            });
          } catch (error) {
            // Error processing postMessage: ${JSON.stringify(error)}
          }
        });
      });
    });
  }

  sendMessage(
    message: PostMessage,
    target: Window = window.parent,
    targetOrigin = '*'
  ): boolean {
    try {
      target.postMessage(message, targetOrigin);
      return true;
    } catch (error) {
      // Error sending postMessage: ${JSON.stringify(error)}
      return false;
    }
  }

  sendMessageToIframe(
    message: PostMessage,
    iframe: HTMLIFrameElement,
    targetOrigin = '*'
  ): boolean {
    if (!iframe || !iframe.contentWindow) {
      // Invalid iframe or contentWindow is null
      return false;
    }

    return this.sendMessage(message, iframe.contentWindow, targetOrigin);
  }

  getMessages<T extends PostMessage>(type: string): Observable<{ message: T, source: MessageEventSource | null }> {
    return this.messages$.pipe(
      filter(event => event.message.type === type),
      map(event => ({
        message: event.message as T,
        source: event.source
      }))
    );
  }

  generateSessionId(): string {
    return Math.floor(Math.random() * 20000000 + 10000000).toString();
  }
}
