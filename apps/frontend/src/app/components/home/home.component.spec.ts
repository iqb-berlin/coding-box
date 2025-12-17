import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { HomeComponent } from './home.component';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';
import { AppService } from '../../services/app.service';
import { SERVER_URL } from '../../injection-tokens';

const mockAuthService = {
  isLoggedIn: jest.fn(() => true)
};

const mockActivatedRoute = {
  snapshot: {
    data: {
      someData: 'test-data'
    }
  },
  queryParams: of({})
};

const mockAppService = {
  refreshAuthData: jest.fn(),
  authData$: of({
    workspaces: []
  }),
  userProfile: {
    firstName: '',
    lastName: ''
  }
};

describe('HomeComponent', () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: AuthService, useValue: mockAuthService },
        { provide: AppService, useValue: mockAppService },
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        provideHttpClient()
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
