import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { HttpClientModule } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
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
});
