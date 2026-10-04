import { Injectable, NgZone, OnDestroy } from '@angular/core';
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

export type PostMessageEvent<T extends PostMessage = PostMessage> = {
  message: T;
  source: MessageEventSource | null;
  origin: string;
};

@Injectable({
  providedIn: 'root'
})
export class PostMessageService implements OnDestroy {
  private readonly messageListener = (event: MessageEvent): void => {
    this.zone.run(() => {
      const message = event.data as PostMessage;
      this.messageSubject.next({ message, source: event.source, origin: event.origin });
    });
  };

  private readonly messageSubject: Subject<PostMessageEvent> =
    new Subject<PostMessageEvent>();

  readonly messages$: Observable<PostMessageEvent> =
    this.messageSubject.asObservable();

  constructor(private readonly zone: NgZone) {
    this.setupMessageListener();
  }

  private setupMessageListener(): void {
    // Use NgZone.runOutsideAngular to avoid unnecessary change detection
    this.zone.runOutsideAngular(() => {
      window.addEventListener('message', this.messageListener);
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('message', this.messageListener);
    this.messageSubject.complete();
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

  getMessages<T extends PostMessage>(type: string): Observable<PostMessageEvent<T>> {
    return this.messages$.pipe(
      filter(event => event.message.type === type),
      map(event => ({
        message: event.message as T,
        source: event.source,
        origin: event.origin
      }))
    );
  }

  generateSessionId(): string {
    return Math.floor(Math.random() * 20000000 + 10000000).toString();
  }
}
