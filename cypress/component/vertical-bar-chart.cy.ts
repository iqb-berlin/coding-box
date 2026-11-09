import { Component, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { Chart, Plugin } from 'chart.js';
import {
  BarChartDatum, VerticalBarChartComponent
} from '../../apps/frontend/src/app/shared/components/vertical-bar-chart/vertical-bar-chart.component';

@Component({
  imports: [VerticalBarChartComponent],
  template: `<coding-box-vertical-bar-chart [results]="results()" [view]="view()"
    xAxisLabel="Unit" yAxisLabel="Replay count" />`
})
class ChartHostComponent {
  readonly results = signal<BarChartDatum[]>([]);
  readonly view = signal<[number, number]>([1800, 900]);
}

describe('Chart resizing during animation', () => {
  let resizePlugin: Plugin | undefined;
  let restorePixelRatio: (() => void) | undefined;

  beforeEach(() => {
    resizePlugin = undefined;
    restorePixelRatio = undefined;
  });

  afterEach(() => {
    if (resizePlugin) Chart.unregister(resizePlugin);
    restorePixelRatio?.();
  });

  for (const pixelRatio of [1, 2]) {
    it(`keeps bars painted when resized during an animation at pixel ratio ${pixelRatio}`, () => {
      let host: ChartHostComponent | undefined;
      let resized = false;
      resizePlugin = {
        id: 'resize-during-animation',
        afterDraw(chart) {
          if (host && chart.data.labels?.length && !resized) {
            resized = true;
            host.view.set([600, 300]);
          }
        }
      };
      Chart.register(resizePlugin);
      cy.window().then(win => {
        const descriptor = Object.getOwnPropertyDescriptor(win, 'devicePixelRatio');
        Object.defineProperty(win, 'devicePixelRatio', { configurable: true, value: pixelRatio });
        restorePixelRatio = () => {
          if (descriptor) Object.defineProperty(win, 'devicePixelRatio', descriptor);
        };
        const matchMedia = win.matchMedia.bind(win);
        cy.stub(win, 'matchMedia').callsFake((query: string) => {
          const result = matchMedia(query);
          if (query === '(prefers-reduced-motion: reduce)') {
            Object.defineProperty(result, 'matches', { value: false });
          }
          return result;
        });
      });
      // Keep animation time fixed until the resize has reached a real draw.
      // RAF still runs, so this also covers slow CI without timing-based sleeps.
      cy.clock(0, ['Date']);
      cy.mount(ChartHostComponent, { imports: [TranslateModule.forRoot()] }).then(({ component }) => {
        host = component;
        host.results.set([{ name: 'UNIT', value: 4 }]);
      });
      cy.get('canvas').should(elements => {
        const canvas = elements[0] as HTMLCanvasElement;
        const chart = Chart.getChart(canvas)!;
        expect(resized, 'Resize during drawing').to.equal(true);
        expect(chart.width).to.equal(600);
        expect(chart.height).to.equal(300);
        expect(canvas.width).to.equal(600 * pixelRatio);
        expect(canvas.height).to.equal(300 * pixelRatio);
      });
      cy.tick(600);
      cy.get('canvas').should(elements => {
        const canvas = elements[0] as HTMLCanvasElement;
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let painted = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] === 100 && pixels[index + 1] === 124 && pixels[index + 2] === 138 && pixels[index + 3] > 0) painted++;
        }
        expect(painted, 'Painted first bar after animated resize').to.be.greaterThan(30);
      });
    });
  }
});
