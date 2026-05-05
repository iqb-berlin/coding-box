import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { StatisticsCardComponent } from './statistics-card.component';

describe('StatisticsCardComponent', () => {
  let component: StatisticsCardComponent;
  let fixture: ComponentFixture<StatisticsCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        StatisticsCardComponent,
        TranslateModule.forRoot(),
        NoopAnimationsModule
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(StatisticsCardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should emit loadStatistics when load button is clicked', () => {
    jest.spyOn(component.loadStatistics, 'emit');
    component.statisticsLoaded = false;
    component.isLoading = false;
    fixture.detectChanges();

    component.onLoadStatistics();
    expect(component.loadStatistics.emit).toHaveBeenCalled();
  });

  it('should emit versionChange when version is changed', () => {
    jest.spyOn(component.versionChange, 'emit');
    component.onVersionChange('v2');
    expect(component.versionChange.emit).toHaveBeenCalledWith('v2');
  });

  it('should calculate status percentage correctly', () => {
    component.codingStatistics = {
      totalResponses: 100,
      statusCounts: { 200: 25, 300: 75 }
    };
    expect(component.getStatusPercentage('200')).toBe(25);
    expect(component.getStatusPercentage('300')).toBe(75);
  });

  it('should return 0 percentage for missing status', () => {
    component.codingStatistics = {
      totalResponses: 100,
      statusCounts: { 200: 25 }
    };
    expect(component.getStatusPercentage('999')).toBe(0);
  });

  it('should format difference correctly', () => {
    expect(component.formatDifference(10)).toBe('+10');
    expect(component.formatDifference(-5)).toBe('-5');
    expect(component.formatDifference(0)).toBe('±0');
    expect(component.formatDifference(null)).toBe('');
  });

  it('should calculate total responses difference', () => {
    component.selectedVersion = 'v2';
    component.codingStatistics = { totalResponses: 150, statusCounts: {} };
    component.referenceStatistics = { totalResponses: 100, statusCounts: {} };

    expect(component.getTotalResponsesDifference()).toBe(50);
  });

  it('should expose effective derived responses without ignored response states', () => {
    component.codingStatistics = {
      totalResponses: 12,
      baseResponseCount: 7,
      derivedResponseCount: 5,
      derivedVariableCount: 2,
      statusCounts: { 5: 10, 1: 2 },
      derivedStatusCounts: { 5: 3, 1: 2 }
    };

    expect(component.effectiveTotalResponses).toBe(10);
    expect(component.effectiveDerivedResponses).toBe(3);
    expect(component.derivedAnswerCount).toBe(3);
    expect(component.derivedVariableCount).toBe(2);
    expect(component.hasDerivedStatistics).toBe(true);
  });

  it('should not infer derived answers from derived variable definitions', () => {
    component.codingStatistics = {
      totalResponses: 2926,
      baseResponseCount: 2926,
      derivedResponseCount: 0,
      derivedVariableCount: 2,
      statusCounts: {
        5: 1781,
        6: 273,
        7: 7,
        8: 865
      },
      derivedStatusCounts: {}
    };

    expect(component.effectiveTotalResponses).toBe(2926);
    expect(component.derivedAnswerCount).toBe(0);
    expect(component.derivedVariableCount).toBe(2);
    expect(component.hasDerivedStatistics).toBe(false);
  });

  it('should not show derived answers after the run was reset', () => {
    component.codingStatistics = {
      totalResponses: 0,
      baseResponseCount: 0,
      derivedResponseCount: 0,
      derivedVariableCount: 2,
      statusCounts: {},
      derivedStatusCounts: {}
    };

    expect(component.effectiveTotalResponses).toBe(0);
    expect(component.derivedAnswerCount).toBe(0);
    expect(component.derivedVariableCount).toBe(2);
    expect(component.hasDerivedStatistics).toBe(false);
  });

  it('should render derived answer statistics when available', () => {
    fixture.componentRef.setInput('statisticsLoaded', true);
    fixture.componentRef.setInput('isLoading', false);
    fixture.componentRef.setInput('codingStatistics', {
      totalResponses: 10,
      baseResponseCount: 7,
      derivedResponseCount: 3,
      derivedVariableCount: 1,
      statusCounts: { 5: 10 },
      derivedStatusCounts: { 5: 3 }
    });

    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('coding-management.statistics.derived-answers');
    expect(text).toContain('3');
  });

  it('should return null for difference when no reference statistics', () => {
    component.selectedVersion = 'v2';
    component.codingStatistics = { totalResponses: 150, statusCounts: {} };
    component.referenceStatistics = null;

    expect(component.getTotalResponsesDifference()).toBeNull();
  });

  it('should emit statusClick when status is clicked', () => {
    jest.spyOn(component.statusClick, 'emit');
    component.onStatusClick('200');
    expect(component.statusClick.emit).toHaveBeenCalledWith('200');
  });

  it('should emit derivedClick when derived answers are clicked', () => {
    jest.spyOn(component.derivedClick, 'emit');
    component.onDerivedClick();
    expect(component.derivedClick.emit).toHaveBeenCalled();
  });
});
