import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone,
  afterRenderEffect, computed, inject, input, signal, viewChild
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import {
  BarController, BarElement, CategoryScale, Chart, ChartConfiguration, LinearScale, Tooltip
} from 'chart.js';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip);

export interface BarChartDatum {
  name: string;
  value: number;
}

let nextTableId = 0;

@Component({
  selector: 'coding-box-vertical-bar-chart',
  imports: [TranslateModule],
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

  readonly tableToggleId: string;
  readonly width = computed(() => Math.max(320, this.view()[0], this.results().length * 28 + 96));
  readonly height = computed(() => Math.max(240, this.view()[1]));
  readonly rows = computed(() => this.results().map(datum => ({
    name: datum.name,
    value: Number.isFinite(datum.value) ? Math.max(0, datum.value) : 0
  })));

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly reducedMotion = signal(false);
  private readonly colors = [
    '#647c8a', '#3f51b5', '#2196f3', '#00b862', '#afdf0a',
    '#a7b61a', '#f3e562', '#ff9800', '#ff5722', '#ff4514'
  ];

  private chart?: Chart<'bar', number[], string>;
  private motionQuery?: MediaQueryList;
  private readonly motionChanged = (event: MediaQueryListEvent): void => {
    this.reducedMotion.set(event.matches);
  };

  constructor() {
    nextTableId += 1;
    this.tableToggleId = `bar-chart-data-${nextTableId}`;
    afterRenderEffect(() => {
      const canvas = this.canvas().nativeElement;
      if (!this.motionQuery) {
        this.motionQuery = this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
        if (this.motionQuery) {
          this.reducedMotion.set(this.motionQuery.matches);
          this.motionQuery.addEventListener('change', this.motionChanged);
        }
      }
      const labels = this.rows().map(row => row.name);
      const formatTick = this.xAxisTickFormatting();
      const rotated = this.rotateXAxisTicks();
      const reducedMotion = this.reducedMotion();
      const width = this.width();
      const height = this.height();
      const styles = this.document.defaultView?.getComputedStyle(canvas);
      const color = styles?.color || '#666';
      const configuration: ChartConfiguration<'bar', number[], string> = {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: this.yAxisLabel(),
            data: this.rows().map(row => row.value),
            backgroundColor: labels.map((_, index) => this.colors[index % this.colors.length]),
            borderRadius: 5,
            borderSkipped: 'start',
            maxBarThickness: 90
          }]
        },
        options: {
          // The dialog supplies its observed dimensions. Explicit resizing also
          // gives scrollable charts a stable minimum category width.
          responsive: false,
          color,
          font: { family: styles?.fontFamily || 'sans-serif' },
          animation: reducedMotion ? false : { duration: 500, easing: 'easeOutQuart' },
          transitions: { resize: { animation: { duration: reducedMotion ? 0 : 300 } } },
          plugins: {
            tooltip: { callbacks: { title: items => items[0]?.label || '' } }
          },
          scales: {
            x: {
              title: { display: true, text: this.xAxisLabel(), color },
              grid: { display: false },
              ticks: {
                color,
                autoSkip: true,
                autoSkipPadding: 16,
                minRotation: rotated ? 35 : 0,
                maxRotation: rotated ? 35 : 0,
                callback: value => formatTick(labels[Number(value)] || '')
              }
            },
            y: {
              beginAtZero: true,
              title: { display: true, text: this.yAxisLabel(), color },
              grid: { color: 'rgba(128, 128, 128, 0.2)' },
              ticks: { color }
            }
          }
        }
      };
      this.zone.runOutsideAngular(() => {
        if (this.chart) {
          // Chart.js mutates its configuration; keep signal-owned arrays private.
          this.chart.data.labels = configuration.data.labels;
          Object.assign(this.chart.data.datasets[0], configuration.data.datasets[0]);
          this.chart.options = configuration.options || {};
          if (reducedMotion) this.chart.stop();
          this.chart.resize(width, height);
          this.chart.update(reducedMotion ? 'none' : undefined);
        } else {
          this.chart = new Chart(canvas, configuration);
        }
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.motionQuery?.removeEventListener('change', this.motionChanged);
      this.zone.runOutsideAngular(() => this.chart?.destroy());
      this.chart = undefined;
    });
  }
}
