import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Subject } from 'rxjs';
import { StandaloneUnitSchemerComponent } from './unit-schemer.component';
import { PostMessageEvent, PostMessageService } from '../../../core/services/post-message.service';
import { SchemerMessage } from '../../../core/services/post-message-types';

describe('Embedded Schemer feedback without Zone.js', () => {
  let fixture: ComponentFixture<StandaloneUnitSchemerComponent>;
  let ready$: Subject<PostMessageEvent<SchemerMessage>>;
  let read$: Subject<PostMessageEvent<SchemerMessage>>;
  let changes$: Subject<PostMessageEvent<SchemerMessage>>;
  let clearFeedback: (() => void) | undefined;
  let timeoutSpy: jest.SpyInstance;

  beforeEach(async () => {
    clearFeedback = undefined;
    ready$ = new Subject();
    read$ = new Subject();
    changes$ = new Subject<PostMessageEvent<SchemerMessage>>();
    const originalSetTimeout = globalThis.setTimeout;
    timeoutSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation((handler, timeout, ...args) => {
      if (timeout === 3000 && typeof handler === 'function') {
        clearFeedback = handler as () => void;
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return originalSetTimeout(handler, timeout, ...args);
    });
    await TestBed.configureTestingModule({
      imports: [StandaloneUnitSchemerComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: PostMessageService,
          useValue: {
            getMessages: (type: string) => {
              if (type === 'vosReadyNotification') return ready$;
              if (type === 'vosReadNotification') return read$;
              return changes$;
            },
            generateSessionId: () => 'schemer-session',
            sendMessageToIframe: jest.fn()
          }
        }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(StandaloneUnitSchemerComponent);
    fixture.componentRef.setInput('schemerHtml', '<html><body>Example Schemer</body></html>');
    fixture.autoDetectChanges();
    await fixture.whenStable();
    const source = fixture.nativeElement.querySelector('iframe').contentWindow;
    ready$.next({ source, origin: '', message: { type: 'vosReadyNotification', sessionId: '' } });
  });

  afterEach(() => {
    fixture.destroy();
    timeoutSpy.mockRestore();
  });

  function reportReadFeedback(): void {
    const source = fixture.nativeElement.querySelector('iframe').contentWindow;
    read$.next({
      source,
      origin: '',
      message: {
        type: 'vosReadNotification',
        sessionId: 'schemer-session',
        message: 'Schema konnte nicht vollständig gelesen werden'
      }
    });
  }

  it('keeps reported changes local, preserves variables and accepts a replacement input', async () => {
    const variables: never[] = [];
    const original = Object.freeze({ scheme: 'original', schemeType: 'type', variables });
    fixture.componentRef.setInput('unitScheme', original);
    const changed = jest.fn();
    fixture.componentInstance.schemeChanged.subscribe(changed);
    await fixture.whenStable();
    const source = fixture.nativeElement.querySelector('iframe').contentWindow;
    changes$.next({
      source,
      origin: '',
      message: {
        type: 'vosSchemeChangedNotification', sessionId: 'schemer-session', codingScheme: 'edited'
      }
    });
    const sender = TestBed.inject(PostMessageService).sendMessageToIframe as jest.Mock;
    fixture.componentInstance.sendUnitScheme();
    expect(fixture.componentInstance.unitScheme()).toBe(original);
    expect(original.scheme).toBe('original');
    expect(changed).toHaveBeenCalledWith({ scheme: 'edited', schemeType: 'type', variables });
    expect(sender).toHaveBeenLastCalledWith(expect.objectContaining({ codingScheme: 'edited', variables }), expect.anything());

    fixture.componentRef.setInput('unitScheme', { scheme: 'replacement', schemeType: 'new-type' });
    await fixture.whenStable();
    fixture.componentInstance.sendUnitScheme();
    expect(sender).toHaveBeenLastCalledWith(expect.objectContaining({ codingScheme: 'replacement', codingSchemeType: 'new-type' }), expect.anything());
  });

  it('unsubscribes from Schemer changes when the hosting view is destroyed', () => {
    expect(changes$.observed).toBe(true);
    fixture.destroy();
    expect(changes$.observed).toBe(false);
    expect(ready$.observed).toBe(false);
    expect(read$.observed).toBe(false);
  });

  it('renders the read notification without an unrelated Angular event', async () => {
    reportReadFeedback();
    await fixture.whenStable();
    expect(fixture.componentInstance.message()).toBe('Schema konnte nicht vollständig gelesen werden');
    expect(fixture.nativeElement.querySelector('.message')?.textContent)
      .toContain('Schema konnte nicht vollständig gelesen werden');
  });

  it('removes feedback after its scheduled clear without another Angular event', async () => {
    reportReadFeedback();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.message')).not.toBeNull();
    expect(clearFeedback).toBeDefined();
    clearFeedback!();
    await fixture.whenStable();
    expect(fixture.componentInstance.message()).toBe('');
    expect(fixture.nativeElement.querySelector('.message')).toBeNull();
  });
});
