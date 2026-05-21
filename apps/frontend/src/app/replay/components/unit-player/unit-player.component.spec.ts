import { ComponentFixture, TestBed } from '@angular/core/testing';
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
});
