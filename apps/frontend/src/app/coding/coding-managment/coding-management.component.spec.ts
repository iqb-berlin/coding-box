import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { CodingManagementComponent } from './coding-management.component';
import { environment } from '../../../environments/environment';
import { provideHttpClient } from '@angular/common/http';

describe('CodingManagementComponent', () => {
  let component: CodingManagementComponent;
  let fixture: ComponentFixture<CodingManagementComponent>;

  const fakeActivatedRoute = {
    snapshot: { data: { } }
  } as ActivatedRoute;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        {
          provide: 'SERVER_URL',
          useValue: environment.backendUrl
        },
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        }],
      imports: [
        TranslateModule.forRoot()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingManagementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
