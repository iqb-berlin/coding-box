import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { HttpClientModule } from '@angular/common/http';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UnitPlayerComponent } from './unit-player.component';
import { environment } from '../../../../environments/environment';
import { SERVER_URL } from '../../../injection-tokens';

describe('UnitPlayerComponent', () => {
  let component: UnitPlayerComponent;
  let fixture: ComponentFixture<UnitPlayerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        }
      ],
      imports: [
        UnitPlayerComponent,
        TranslateModule.forRoot(),
        HttpClientModule
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UnitPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
