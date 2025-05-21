import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { HomeComponent } from './home.component';
import { AuthService } from '../../auth/service/auth.service';
import { environment } from '../../../environments/environment';

const mockAuthService = {
  isLoggedIn: jest.fn(() => true)
};

const mockActivatedRoute = {
  snapshot: {
    data: {
      someData: 'test-data'
    }
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
        {
          provide: 'SERVER_URL',
          useValue: environment.backendUrl
        }, provideHttpClient()]
    })
      .compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
