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
import { WsUsersComponent } from './ws-users.component';
import { environment } from '../../../../environments/environment';

describe('WsUsersComponent', () => {
  let component: WsUsersComponent;
  let fixture: ComponentFixture<WsUsersComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        MatSnackBarModule,
        MatCheckboxModule,
        MatTooltipModule,
        MatIconModule,
        MatTableModule,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        provideHttpClient(),
        {
          provide: 'SERVER_URL',
          useValue: environment.backendUrl
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(WsUsersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
