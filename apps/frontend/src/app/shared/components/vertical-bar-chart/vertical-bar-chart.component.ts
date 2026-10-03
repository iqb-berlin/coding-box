import {
  ChangeDetectionStrategy, Component, computed, input
} from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface BarChartDatum {
  name: string;
  value: number;
}

@Component({
  selector: 'coding-box-vertical-bar-chart',
  imports: [MatTooltipModule],
  templateUrl: './vertical-bar-chart.component.html',
  styleUrl: './vertical-bar-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class VerticalBarChartComponent {
  readonly results = input.required<readonly BarChartDatum[]>();
  readonly view = input<readonly [number, number]>([900, 520]);
  readonly xAxisLabel = input.required<string>();
  readonly yAxisLabel = input.required<string>();
  readonly rotateXAxisTicks = input(false);
  readonly xAxisTickFormatting = input<(value: string) => string>(value => value);

  private readonly colors = ['#647c8a', '#3f51b5', '#2196f3', '#00b862', '#afdf0a', '#a7b61a'];
  readonly left = 76;
  readonly top = 20;
  readonly width = computed(() => Math.max(320, this.view()[0], this.results().length * 28 + this.left + 20));
  readonly height = computed(() => Math.max(240, this.view()[1]));
  readonly plotWidth = computed(() => this.width() - this.left - 20);
  readonly plotHeight = computed(() => this.height() - this.top - (this.rotateXAxisTicks() ? 125 : 85));
  readonly baseline = computed(() => this.top + this.plotHeight());

  // Counts and durations are nonnegative. Keep an empty/zero chart finite,
  // and use round scale steps without rounding away fractional durations.
  readonly scale = computed(() => {
    const maximum = this.results().reduce((max, datum) => Math.max(max, this.safeValue(datum.value)), 0);
    const roughStep = (maximum || 1) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const normalized = roughStep / magnitude;
    const factor = [1, 2, 5, 10].find(value => value >= normalized) ?? 10;
    const step = factor * magnitude;
    const count = Math.ceil((maximum || 1) / step);
    return { step, maximum: count * step, count };
  });

  readonly ticks = computed(() => Array.from({ length: this.scale().count + 1 }, (_, index) => {
    const value = Number((index * this.scale().step).toPrecision(12));
    return {
      value,
      y: this.baseline() - (value / this.scale().maximum) * this.plotHeight()
    };
  }));

  readonly bars = computed(() => {
    const results = this.results();
    const slot = this.plotWidth() / Math.max(1, results.length);
    const tickStride = Math.max(1, Math.ceil(results.length / (this.plotWidth() / 80)));
    return results.map((datum, index) => {
      const height = (this.safeValue(datum.value) / this.scale().maximum) * this.plotHeight();
      return {
        ...datum,
        x: this.left + index * slot + slot * 0.15,
        y: this.baseline() - height,
        width: slot * 0.7,
        height,
        color: this.colors[index % this.colors.length],
        label: this.xAxisTickFormatting()(datum.name),
        showTick: index % tickStride === 0 || index === results.length - 1,
        description: `${datum.name}: ${datum.value}`
      };
    });
  });

  private safeValue(value: number): number {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }
}
