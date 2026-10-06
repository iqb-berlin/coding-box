import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { Chart } from 'chart.js';
import { VerticalBarChartComponent } from './vertical-bar-chart.component';

describe('Chart.js bar charts without Zone or the Angular animations engine', () => {
  let fixture: ComponentFixture<VerticalBarChartComponent>;
  let motion: EventTarget & { matches: boolean };
  const originalMatchMedia = window.matchMedia;
  const chart = (): Chart<'bar', number[], string> => Chart.getChart(
    fixture.nativeElement.querySelector('canvas')
  ) as Chart<'bar', number[], string>;

  beforeEach(async () => {
    motion = Object.assign(new EventTarget(), { matches: true });
    window.matchMedia = jest.fn().mockReturnValue(motion);
    await TestBed.configureTestingModule({
      imports: [VerticalBarChartComponent, TranslateModule.forRoot()],
      providers: [provideZonelessChangeDetection()]
    }).compileComponents();
    fixture = TestBed.createComponent(VerticalBarChartComponent);
    fixture.componentRef.setInput('results', []);
    fixture.componentRef.setInput('xAxisLabel', 'Unit');
    fixture.componentRef.setInput('yAxisLabel', 'Replay count');
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
    window.matchMedia = originalMatchMedia;
    jest.restoreAllMocks();
  });

  it('renders delayed immutable data, proportional bars and a complete accessible table', async () => {
    const input = Object.freeze([
      Object.freeze({ name: 'Long unit name ä <script>', value: 4 }),
      Object.freeze({ name: 'Other', value: 2 })
    ]);
    fixture.componentRef.setInput('results', input);
    fixture.componentRef.setInput('xAxisTickFormatting', (name: string) => name.slice(0, 5));
    await fixture.whenStable();
    const bars = chart().getDatasetMeta(0).data;
    const first = bars[0].getProps(['base', 'y'], true);
    const second = bars[1].getProps(['base', 'y'], true);
    // Chart.js aligns the baseline to half pixels for crisp axis borders.
    expect(Math.abs((first.base - first.y) - (second.base - second.y) * 2)).toBeLessThanOrEqual(1);
    expect(chart().data.labels).toEqual(['Long unit name ä <script>', 'Other']);
    expect(chart().data.datasets[0].data).not.toBe(input);
    expect(input[0].value).toBe(4);
    expect(fixture.nativeElement.querySelector('canvas').getAttribute('role')).toBe('img');
    expect(fixture.nativeElement.querySelector('canvas').getAttribute('aria-describedby'))
      .toBe(fixture.nativeElement.querySelector('summary').id);
    expect(fixture.nativeElement.querySelector('tbody th').textContent).toBe('Long unit name ä <script>');
    expect(fixture.nativeElement.querySelector('script')).toBeNull();

    fixture.componentRef.setInput('results', [{ name: 'Replacement', value: 3 }]);
    await fixture.whenStable();
    expect(chart().getDatasetMeta(0).data).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('tbody th').textContent).toBe('Replacement');
  });

  it('keeps empty, zero and invalid values finite without dropping duplicate categories', async () => {
    expect(chart().getDatasetMeta(0).data).toHaveLength(0);
    fixture.componentRef.setInput('results', [0, -1, Number.NaN, Number.POSITIVE_INFINITY].map(value => ({ name: 'Same', value })));
    await fixture.whenStable();
    expect(chart().data.datasets[0].data).toEqual([0, 0, 0, 0]);
    expect(chart().getDatasetMeta(0).data).toHaveLength(4);
    chart().getDatasetMeta(0).data.forEach(bar => {
      const { base, y } = bar.getProps(['base', 'y'], true);
      expect(Number.isFinite(y)).toBe(true);
      expect(base).toBe(y);
    });
  });

  it('preserves fractional durations and resizes the existing chart', async () => {
    fixture.componentRef.setInput('results', [{ name: 'A', value: 0.2 }, { name: 'B', value: 0.1 }]);
    fixture.componentRef.setInput('view', [440, 380]);
    await fixture.whenStable();
    const instance = chart();
    const bar = instance.getDatasetMeta(0).data[0];
    expect(instance.data.datasets[0].data).toEqual([0.2, 0.1]);
    expect(instance.width).toBe(440);
    fixture.componentRef.setInput('view', [900, 520]);
    await fixture.whenStable();
    expect(chart()).toBe(instance);
    expect(instance.getDatasetMeta(0).data[0]).toBe(bar);
    expect(instance.width).toBe(900);
    expect(instance.height).toBe(520);
  });

  it('uses measured tick spacing for 30 dates rather than forcing a colliding final tick', async () => {
    fixture.componentRef.setInput('results', Array.from({ length: 30 }, (_, index) => ({
      name: `2026-09-${String(index + 1).padStart(2, '0')}`, value: 4
    })));
    fixture.componentRef.setInput('view', [600, 460]);
    await fixture.whenStable();
    const axis = chart().scales.x;
    const context = chart().ctx;
    context.font = '12px "Helvetica Neue", "Helvetica", "Arial", sans-serif';
    const boxes = axis.ticks.map(tick => ({
      center: axis.getPixelForValue(tick.value),
      width: context.measureText(String(tick.label)).width
    }));
    expect(boxes.length).toBeGreaterThan(1);
    expect(boxes.length).toBeLessThan(30);
    for (let index = 1; index < boxes.length; index++) {
      expect(boxes[index - 1].center + boxes[index - 1].width / 2)
        .toBeLessThanOrEqual(boxes[index].center - boxes[index].width / 2);
    }
  });

  it('reacts to reduced motion and releases chart listeners when destroyed', async () => {
    const instance = chart();
    expect(instance.options.animation).toBe(false);
    motion.matches = false;
    motion.dispatchEvent(Object.assign(new Event('change'), { matches: false }));
    await fixture.whenStable();
    expect(instance.options.animation).toEqual(expect.objectContaining({ duration: 500 }));
    const stop = jest.spyOn(instance, 'stop');
    motion.matches = true;
    motion.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
    await fixture.whenStable();
    expect(stop).toHaveBeenCalled();
    expect(instance.options.animation).toBe(false);
    const destroy = jest.spyOn(instance, 'destroy');
    const remove = jest.spyOn(motion, 'removeEventListener');
    const canvas = fixture.nativeElement.querySelector('canvas');
    fixture.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
    expect(Chart.getChart(canvas)).toBeUndefined();
  });
});
