import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CodingManagementManualComponent } from './coding-management-manual.component';
import { SERVER_URL } from '../../../injection-tokens';
import { environment } from '../../../../environments/environment';

describe('CodingManagementManualComponent', () => {
  let component: CodingManagementManualComponent;
  let fixture: ComponentFixture<CodingManagementManualComponent>;

  const fakeActivatedRoute = {
    snapshot: { data: {} }
  } as ActivatedRoute;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        },
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        provideHttpClient()
      ],
      imports: [CodingManagementManualComponent, TranslateModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingManagementManualComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
