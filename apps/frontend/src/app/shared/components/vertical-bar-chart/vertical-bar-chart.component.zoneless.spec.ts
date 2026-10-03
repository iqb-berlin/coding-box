import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VerticalBarChartComponent } from './vertical-bar-chart.component';

describe('Native vertical bar charts without the Angular animations engine', () => {
  let fixture: ComponentFixture<VerticalBarChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VerticalBarChartComponent],
      providers: [provideZonelessChangeDetection()]
    }).compileComponents();
    fixture = TestBed.createComponent(VerticalBarChartComponent);
    fixture.componentRef.setInput('results', []);
    fixture.componentRef.setInput('xAxisLabel', 'Unit');
    fixture.componentRef.setInput('yAxisLabel', 'Replay count');
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  it('renders delayed input changes with proportional bars and accessible full labels', async () => {
    fixture.componentRef.setInput('results', [{ name: 'Long unit name ä <script>', value: 4 }, { name: 'Other', value: 2 }]);
    fixture.componentRef.setInput('xAxisTickFormatting', (name: string) => name.slice(0, 5));
    await fixture.whenStable();
    const bars: SVGGElement[] = Array.from(fixture.nativeElement.querySelectorAll('.bar'));
    const heights = bars.map(bar => Number(bar.querySelector('rect')?.getAttribute('height')));
    expect(heights[0]).toBe(heights[1] * 2);
    expect(bars[0].getAttribute('aria-label')).toBe('Long unit name ä <script>: 4');
    expect(bars[0].getAttribute('tabindex')).toBe('0');
    expect(fixture.nativeElement.querySelector('script')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Replay count');

    fixture.componentRef.setInput('results', [{ name: 'Replacement', value: 3 }]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('.bar')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('.bar').getAttribute('aria-label')).toBe('Replacement: 3');
  });

  it('handles empty, zero and invalid values with finite nonnegative SVG geometry', async () => {
    expect(fixture.nativeElement.querySelectorAll('.bar')).toHaveLength(0);
    fixture.componentRef.setInput('results', [0, -1, Number.NaN, Number.POSITIVE_INFINITY].map(value => ({ name: 'Same', value })));
    await fixture.whenStable();
    const rectangles: SVGRectElement[] = Array.from(fixture.nativeElement.querySelectorAll('.bar rect'));
    expect(rectangles).toHaveLength(4);
    rectangles.forEach(rectangle => {
      expect(Number(rectangle.getAttribute('height'))).toBe(0);
      expect(Number.isFinite(Number(rectangle.getAttribute('y')))).toBe(true);
    });
  });

  it('keeps fractional durations proportional and adapts to a changed viewport', async () => {
    fixture.componentRef.setInput('results', [{ name: 'A', value: 0.2 }, { name: 'B', value: 0.1 }]);
    fixture.componentRef.setInput('view', [440, 380]);
    await fixture.whenStable();
    const firstHeight = Number(fixture.nativeElement.querySelector('.bar rect').getAttribute('height'));
    expect(firstHeight).toBeGreaterThan(0);
    expect(fixture.nativeElement.textContent).toContain('0.1');
    fixture.componentRef.setInput('view', [900, 520]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('svg').getAttribute('width')).toBe('900');
    expect(Number(fixture.nativeElement.querySelector('.bar rect').getAttribute('height'))).toBeGreaterThan(firstHeight);
  });
});
