// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { WsAccessRightsComponent } from './ws-access-rights.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';

describe('WsAccessRightsComponent', () => {
  let component: WsAccessRightsComponent;
  let fixture: ComponentFixture<WsAccessRightsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideHttpClient(), {
        provide: SERVER_URL,
        useValue: environment.backendUrl
      }],
      imports: [
        MatSnackBarModule,
        MatCheckboxModule,
        MatTooltipModule,
        MatIconModule,
        MatTableModule,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WsAccessRightsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
