import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AppService } from '../../../services/app.service';
import { HomeComponent } from '../../../components/home/home.component';
import { AuthService } from '../../../auth/service/auth.service';

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;

  const mockAppService = {
    authData$: of(AppService.defaultAuthData),
    refreshAuthData: jest.fn(),
    userProfile: {
      firstName: '',
      lastName: ''
    }
  };

  const mockSnackBar = {
    open: jest.fn()
  };

  const mockActivatedRoute = {
    queryParams: of({})
  };
  const mockAuthService = {
    getAuthData: jest.fn(),
    isLoggedIn: jest.fn(() => true),
    login: jest.fn()
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        HomeComponent,
        TranslateModule.forRoot(),
        NoopAnimationsModule
      ],
      providers: [
        { provide: AppService, useValue: mockAppService },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: AuthService, useValue: mockAuthService }

      ]
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
