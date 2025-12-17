import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CodingManagementComponent } from './coding-management.component';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';

describe('CodingManagementComponent', () => {
  let component: CodingManagementComponent;
  let fixture: ComponentFixture<CodingManagementComponent>;

  const fakeActivatedRoute = {
    snapshot: { data: {} }
  } as ActivatedRoute;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        }
      ],
      imports: [TranslateModule.forRoot(), CodingManagementComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingManagementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
