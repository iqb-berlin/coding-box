import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { TestTakersValidationPanelComponent } from './test-takers-validation-panel.component';
import { TestTakersValidationService } from '../../../../services/validation';
import { ValidationPanelHeaderComponent, ValidationGuidanceComponent } from '../../shared';

describe('TestTakersValidationPanelComponent', () => {
  let component: TestTakersValidationPanelComponent;
  let fixture: ComponentFixture<TestTakersValidationPanelComponent>;
  let serviceMock: {
    validate: jest.Mock;
    getValidationStatus: jest.Mock;
    getCachedResult: jest.Mock;
  };

  const mockResult = {
    testTakersFound: true,
    totalGroups: 10,
    totalLogins: 100,
    totalBookletCodes: 50,
    missingPersons: []
  };

  beforeEach(async () => {
    serviceMock = {
      validate: jest.fn(),
      getValidationStatus: jest.fn(),
      getCachedResult: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        CommonModule,
        MatExpansionModule,
        MatProgressSpinnerModule,
        MatIconModule,
        MatSnackBarModule,
        NoopAnimationsModule,
        TestTakersValidationPanelComponent,
        ValidationPanelHeaderComponent,
        ValidationGuidanceComponent
      ],
      providers: [
        { provide: TestTakersValidationService, useValue: serviceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TestTakersValidationPanelComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should call validate on service when button is clicked', () => {
    serviceMock.validate.mockReturnValue(of(mockResult));
    component.onValidate();
    expect(serviceMock.validate).toHaveBeenCalled();
    expect(component.wasRun).toBe(true);
  });

  it('should toggle expansion', () => {
    expect(component.expandedPanel).toBe(false);
    component.toggleExpansion();
    expect(component.expandedPanel).toBe(true);
  });

  it('should reflect service status', () => {
    serviceMock.getValidationStatus.mockReturnValue('success');
    expect(component.status).toBe('success');
  });

  it('should load cached result on init', () => {
    serviceMock.getCachedResult.mockReturnValue(mockResult);
    component.ngOnInit();
    expect(component.result).toEqual(mockResult as unknown as typeof component.result);
    expect(component.wasRun).toBe(true);
  });
});
