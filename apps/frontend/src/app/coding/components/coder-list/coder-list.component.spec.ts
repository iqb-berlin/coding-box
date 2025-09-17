import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations'; // Importiere NoopAnimationsModule
import { CoderListComponent } from './coder-list.component';

describe('CoderListComponent', () => {
  let component: CoderListComponent;
  let fixture: ComponentFixture<CoderListComponent>;

  const fakeActivatedRoute = {
    snapshot: { data: { } }
  } as ActivatedRoute;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: fakeActivatedRoute
        }
      ],
      imports: [
        TranslateModule.forRoot(),
        NoopAnimationsModule // Füge NoopAnimationsModule hier hinzu
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CoderListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
