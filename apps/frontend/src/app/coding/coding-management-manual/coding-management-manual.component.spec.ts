import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CodingManagementManualComponent } from './coding-management-manual.component';
import { environment } from '../../../environments/environment';

describe('CodingManagementManualComponent', () => {
  let component: CodingManagementManualComponent;
  let fixture: ComponentFixture<CodingManagementManualComponent>;

  const fakeActivatedRoute = {
    snapshot: { data: { } }
  } as ActivatedRoute;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        }, {
          provide: 'SERVER_URL',
          useValue: environment.backendUrl
        }, provideHttpClient()],
      imports: [
        TranslateModule.forRoot(),
        CodingManagementManualComponent
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingManagementManualComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
