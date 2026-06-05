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
