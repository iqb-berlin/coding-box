import {
  afterNextRender, afterRenderEffect, DestroyRef, Directive, ElementRef, inject, input, signal
} from '@angular/core';

@Directive({
  selector: '[codingBoxReplayWatermark]',
  exportAs: 'replayWatermark',
  host: { '(window:resize)': 'checkWidth()' }
})
export class ReplayWatermarkDirective {
  readonly text = input.required<string>({ alias: 'codingBoxReplayWatermark' });
  readonly panelWidth = input.required<number>();
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly truncated = signal(false);
  readonly isTruncated = this.truncated.asReadonly();

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterRenderEffect({
      read: () => {
        this.text();
        this.panelWidth();
        this.checkWidth();
      }
    });
    afterNextRender({
      read: () => {
        if (typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(() => this.checkWidth());
        observer.observe(this.element);
        destroyRef.onDestroy(() => observer.disconnect());
      }
    });
  }

  protected checkWidth(): void {
    this.truncated.set(this.element.scrollWidth > this.element.clientWidth + 1);
  }
}
