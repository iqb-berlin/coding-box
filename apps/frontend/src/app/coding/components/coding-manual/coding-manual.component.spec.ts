import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { CodingManualComponent } from './coding-manual.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';

describe('CodingManualComponent', () => {
  let component: CodingManualComponent;
  let fixture: ComponentFixture<CodingManualComponent>;

  const fakeActivatedRoute = {
    snapshot: { data: { } }
  } as ActivatedRoute;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [{
        provide: SERVER_URL,
        useValue: environment.backendUrl
      }, provideHttpClient(), {
        provide: ActivatedRoute,
        useValue: fakeActivatedRoute
      }],
      imports: [
        TranslateModule.forRoot()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingManualComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
