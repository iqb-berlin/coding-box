import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { HttpClientModule } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { UnitPlayerComponent } from './unit-player.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';
import { AppService } from '../../../core/services/app.service';

describe('UnitPlayerComponent', () => {
  let component: UnitPlayerComponent;
  let fixture: ComponentFixture<UnitPlayerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        }
      ],
      imports: [
        UnitPlayerComponent,
        TranslateModule.forRoot(),
        HttpClientModule
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UnitPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit playerReady when the hosted player reports ready', () => {
    const emitSpy = jest.spyOn(component.playerReady, 'emit');
    const appService = TestBed.inject(AppService);
    const source = component.hostingIframe.nativeElement.contentWindow;

    appService.postMessage$.next(new MessageEvent('message', {
      data: {
        type: 'player',
        metadata: { specVersion: '3.0' }
      },
      source
    }));

    expect(emitSpy).toHaveBeenCalled();
  });

  it('should emit responseVisible again after unit responses change', () => {
    const emitSpy = jest.spyOn(component.responseVisible, 'emit');
    const appService = TestBed.inject(AppService);
    const source = component.hostingIframe.nativeElement.contentWindow;
    const emitPlayerStateChanged = () => appService.postMessage$.next(new MessageEvent('message', {
      data: {
        type: 'vopStateChangedNotification'
      },
      source
    }));

    emitPlayerStateChanged();
    expect(emitSpy).toHaveBeenCalledTimes(1);

    component.ngOnChanges({
      unitResponses: new SimpleChange(
        { responses: [{ id: '1', content: 'old response' }] },
        { responses: [{ id: '1', content: 'new response' }] },
        false
      )
    });
    emitPlayerStateChanged();

    expect(emitSpy).toHaveBeenCalledTimes(2);
  });

  it('should forward key events only once after repeated iframe loads', () => {
    const iframe = component.hostingIframe.nativeElement as HTMLIFrameElement;
    const contentWindow = iframe.contentWindow as Window;
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');
    const updateIframeContent = component as unknown as {
      updateIframeContent: (content: string) => void;
    };

    updateIframeContent.updateIframeContent('<html>first player</html>');
    iframe.dispatchEvent(new Event('load'));
    contentWindow.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    updateIframeContent.updateIframeContent('<html>second player</html>');
    iframe.dispatchEvent(new Event('load'));
    contentWindow.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
  });

  it('should clean up iframe listeners and the pending height timeout on destroy', () => {
    fixture.destroy();
    jest.useFakeTimers();
    fixture = TestBed.createComponent(UnitPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const iframe = component.hostingIframe.nativeElement as HTMLIFrameElement;
    const contentWindow = iframe.contentWindow as Window;
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');
    const componentWithPrivateMethods = component as unknown as {
      calculateIFrameHeight: () => number | undefined;
    };
    const calculateHeightSpy = jest.spyOn(componentWithPrivateMethods, 'calculateIFrameHeight');

    iframe.dispatchEvent(new Event('load'));
    fixture.destroy();
    contentWindow.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    jest.advanceTimersByTime(500);

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(calculateHeightSpy).not.toHaveBeenCalled();
  });

  it('should normalize math text array values in replay data parts', () => {
    component.ngOnChanges({
      unitDef: new SimpleChange(undefined, JSON.stringify({
        BaseVariables: {
          Variable: [
            {
              id: '02b',
              type: 'json',
              format: 'math-text-mix'
            },
            {
              id: 'other',
              type: 'json'
            }
          ]
        }
      }), true),
      unitResponses: new SimpleChange(undefined, {
        responses: [{
          id: 'chunk1',
          content: JSON.stringify([
            { id: '02b', value: [], status: 2 },
            { id: 'other', value: ['kept'], status: 2 }
          ])
        }]
      }, true)
    });

    const [mathTextResponse, otherResponse] = JSON.parse(component.dataParts.chunk1);
    expect(mathTextResponse.value).toBe('[]');
    expect(otherResponse.value).toEqual(['kept']);
  });

  it('should reuse prepared assets for response changes and release them on destroy', () => {
    const createObjectURL = jest.fn().mockReturnValue('blob:unit-image');
    const revokeObjectURL = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectURL,
      configurable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectURL,
      configurable: true
    });
    const postMessage = jest.fn();
    component.postMessageTarget = { postMessage } as unknown as Window;
    const definition = JSON.stringify({
      image: 'data:image/png;base64,aGVsbG8='
    });

    const firstResponses = {
      responses: [{ id: 'answer', content: 'first answer' }]
    };
    const secondResponses = {
      responses: [{ id: 'answer', content: 'second answer' }]
    };
    component.ngOnChanges({
      unitDef: new SimpleChange(undefined, definition, true),
      unitResponses: new SimpleChange(undefined, firstResponses, true)
    });
    component.ngOnChanges({
      unitResponses: new SimpleChange(firstResponses, secondResponses, false)
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[0][0].unitDefinition).toContain('blob:unit-image');
    expect(postMessage.mock.calls[1][0].unitDefinition).toBe(
      postMessage.mock.calls[0][0].unitDefinition
    );
    expect(postMessage.mock.calls[0][0].unitState.dataParts.answer).toBe('"first answer"');
    expect(postMessage.mock.calls[1][0].unitState.dataParts.answer).toBe('"second answer"');

    fixture.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:unit-image');
  });

  it('should retry once with the original definition after a player asset error', () => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: jest.fn().mockReturnValue('blob:unit-image'),
      configurable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: jest.fn(),
      configurable: true
    });
    const postMessage = jest.fn();
    component.postMessageTarget = { postMessage } as unknown as Window;
    const definition = JSON.stringify({
      image: 'data:image/png;base64,aGVsbG8='
    });
    component.ngOnChanges({
      unitDef: new SimpleChange(undefined, definition, true)
    });
    const appService = TestBed.inject(AppService);
    const source = component.hostingIframe.nativeElement.contentWindow;

    appService.postMessage$.next(new MessageEvent('message', {
      data: {
        type: 'vopRuntimeErrorNotification',
        code: 'image-not-loading'
      },
      source
    }));
    appService.postMessage$.next(new MessageEvent('message', {
      data: {
        type: 'vopRuntimeErrorNotification',
        code: 'image-not-loading'
      },
      source
    }));

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[0][0].unitDefinition).toContain('blob:unit-image');
    expect(postMessage.mock.calls[1][0].unitDefinition).toBe(definition);
  });

  it('should retry with the original definition after an iframe blob asset fails', () => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: jest.fn().mockReturnValue('blob:unit-image'),
      configurable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: jest.fn(),
      configurable: true
    });
    const postMessage = jest.fn();
    component.postMessageTarget = { postMessage } as unknown as Window;
    const definition = JSON.stringify({
      image: 'data:image/png;base64,aGVsbG8='
    });
    component.ngOnChanges({
      unitDef: new SimpleChange(undefined, definition, true)
    });
    const iframe = component.hostingIframe.nativeElement as HTMLIFrameElement;
    iframe.dispatchEvent(new Event('load'));
    const failedImage = iframe.contentDocument?.createElement('img');

    expect(failedImage).toBeTruthy();
    failedImage!.src = 'blob:unit-image';
    iframe.contentDocument?.body.appendChild(failedImage!);
    failedImage!.dispatchEvent(new Event('error'));

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[1][0].unitDefinition).toBe(definition);
  });

  it('should ignore a delayed iframe error from a previously released blob asset', () => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: jest.fn()
        .mockReturnValueOnce('blob:first-unit-image')
        .mockReturnValueOnce('blob:second-unit-image'),
      configurable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: jest.fn(),
      configurable: true
    });
    const postMessage = jest.fn();
    component.postMessageTarget = { postMessage } as unknown as Window;
    component.ngOnChanges({
      unitDef: new SimpleChange(undefined, JSON.stringify({
        image: 'data:image/png;base64,aGVsbG8='
      }), true)
    });
    component.ngOnChanges({
      unitDef: new SimpleChange(JSON.stringify({
        image: 'data:image/png;base64,aGVsbG8='
      }), JSON.stringify({
        image: 'data:image/png;base64,d29ybGQ='
      }), false)
    });
    const iframe = component.hostingIframe.nativeElement as HTMLIFrameElement;
    iframe.dispatchEvent(new Event('load'));
    const staleImage = iframe.contentDocument?.createElement('img');

    expect(staleImage).toBeTruthy();
    staleImage!.src = 'blob:first-unit-image';
    iframe.contentDocument?.body.appendChild(staleImage!);
    staleImage!.dispatchEvent(new Event('error'));

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[1][0].unitDefinition).toContain('blob:second-unit-image');
  });

  it('should retry with the original definition when the prepared unit does not start', () => {
    jest.useFakeTimers();
    Object.defineProperty(URL, 'createObjectURL', {
      value: jest.fn().mockReturnValue('blob:unit-image'),
      configurable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: jest.fn(),
      configurable: true
    });
    const postMessage = jest.fn();
    component.postMessageTarget = { postMessage } as unknown as Window;
    const definition = JSON.stringify({
      image: 'data:image/png;base64,aGVsbG8='
    });

    component.ngOnChanges({
      unitDef: new SimpleChange(undefined, definition, true)
    });
    jest.advanceTimersByTime(10_000);

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(postMessage.mock.calls[1][0].unitDefinition).toBe(definition);
  });

  it('should keep the prepared definition after the player confirms startup', () => {
    jest.useFakeTimers();
    Object.defineProperty(URL, 'createObjectURL', {
      value: jest.fn().mockReturnValue('blob:unit-image'),
      configurable: true
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: jest.fn(),
      configurable: true
    });
    const postMessage = jest.fn();
    component.postMessageTarget = { postMessage } as unknown as Window;
    component.ngOnChanges({
      unitDef: new SimpleChange(undefined, JSON.stringify({
        image: 'data:image/png;base64,aGVsbG8='
      }), true)
    });
    const appService = TestBed.inject(AppService);
    const source = component.hostingIframe.nativeElement.contentWindow;

    appService.postMessage$.next(new MessageEvent('message', {
      data: { type: 'vopStateChangedNotification' },
      source
    }));
    jest.advanceTimersByTime(10_000);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0].unitDefinition).toContain('blob:unit-image');
  });

  it('should not emit a page error when requested page 0 is valid and current', () => {
    const emitSpy = jest.spyOn(component.invalidPage, 'emit');

    (component as unknown as {
      evaluatePageError: (
        pageId: string,
        validPages: { pages: string[]; current: string }
      ) => void;
    }).evaluatePageError('0', { pages: ['0'], current: '0' });

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('should emit a page error when requested page 1 is not part of a single-page unit', () => {
    const emitSpy = jest.spyOn(component.invalidPage, 'emit');

    (component as unknown as {
      evaluatePageError: (
        pageId: string,
        validPages: { pages: string[]; current: string }
      ) => void;
    }).evaluatePageError('1', { pages: ['0'], current: '0' });

    expect(emitSpy).toHaveBeenCalledWith('notInList');
  });

  it('should navigate directly without restarting the player', () => {
    const postMessage = jest.fn();
    component.postMessageTarget = { postMessage } as unknown as Window;
    component.playerApiVersion = 3;

    expect(component.navigateToPage('page-2')).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'vopPageNavigationCommand',
      sessionId: '',
      target: 'page-2'
    }, '*');
  });

  it('should emit responseVisible again when navigating to the current page', () => {
    const emitSpy = jest.spyOn(component.responseVisible, 'emit');
    const appService = TestBed.inject(AppService);
    const source = component.hostingIframe.nativeElement.contentWindow;
    component.postMessageTarget = source;

    appService.postMessage$.next(new MessageEvent('message', {
      data: {
        type: 'vopStateChangedNotification',
        playerState: {
          validPages: ['page-1'],
          currentPage: 'page-1'
        }
      },
      source
    }));
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(component.pageList).toEqual([]);

    expect(component.navigateToPage('page-1')).toBe(true);

    expect(emitSpy).toHaveBeenCalledTimes(2);
  });

  it('should handle a player state without a current page', () => {
    const appService = TestBed.inject(AppService);
    const source = component.hostingIframe.nativeElement.contentWindow;

    expect(() => {
      appService.postMessage$.next(new MessageEvent('message', {
        data: {
          type: 'vopStateChangedNotification',
          playerState: {
            validPages: ['page-1'],
            currentPage: null
          }
        },
        source
      }));
    }).not.toThrow();

    expect(
      (component as unknown as { currentPageId: string }).currentPageId
    ).toBe('');
  });

  it('should validate the requested page again after direct navigation', () => {
    jest.useFakeTimers();
    const emitSpy = jest.spyOn(component.invalidPage, 'emit');
    component.postMessageTarget = { postMessage: jest.fn() } as unknown as Window;

    (component as unknown as {
      validPages: Subject<{ pages: string[]; current: string }>;
    }).validPages.next({
      pages: ['page-1'],
      current: 'page-1'
    });

    expect(component.navigateToPage('page-2')).toBe(true);
    jest.advanceTimersByTime(2000);

    expect(emitSpy).toHaveBeenCalledWith('notInList');
  });

  it('should validate a new page again after responses change', () => {
    jest.useFakeTimers();
    const emitSpy = jest.spyOn(component.invalidPage, 'emit');
    const validPages = (component as unknown as {
      validPages: Subject<{ pages: string[]; current: string }>;
    }).validPages;

    fixture.componentRef.setInput('pageId', 'page-1');
    fixture.componentRef.setInput('unitResponses', { responses: [] });
    fixture.detectChanges();
    validPages.next({ pages: ['page-1'], current: 'page-1' });
    jest.advanceTimersByTime(2000);
    expect(emitSpy).not.toHaveBeenCalled();

    fixture.componentRef.setInput('pageId', 'page-2');
    fixture.componentRef.setInput('unitResponses', {
      responses: [{ id: '1', content: 'new response' }]
    });
    fixture.detectChanges();
    validPages.next({ pages: ['page-1'], current: 'page-1' });
    jest.advanceTimersByTime(2000);

    expect(emitSpy).toHaveBeenCalledWith('notInList');
  });

  it('should not navigate before the player is ready', () => {
    component.postMessageTarget = undefined;

    expect(component.navigateToPage('page-2')).toBe(false);
  });
});
