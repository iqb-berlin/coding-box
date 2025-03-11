// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { HttpClientModule } from '@angular/common/http';
import {
  Component, Input
} from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { environment } from '../../../../environments/environment';
import { TestResultsComponent } from './test-results.component';

describe('TestResultsComponent', () => {
  let component: TestResultsComponent;
  let fixture: ComponentFixture<TestResultsComponent>;

  @Component({ selector: 'coding-box-search-filter', template: '' })
  class MockSearchFilterComponent {
    @Input() title!: string;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [
        MockSearchFilterComponent
      ],
      imports: [
        MatSnackBarModule,
        MatCheckboxModule,
        MatTooltipModule,
        MatIconModule,
        MatTableModule,
        HttpClientModule,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: 'SERVER_URL',
          useValue: environment.backendUrl
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TestResultsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
