import { Directive, input, output } from '@angular/core';

@Directive({
  selector: '[codingBoxReplayPanelResize]',
  exportAs: 'replayPanelResize',
  host: {
    '(document:mousemove)': 'move($event)',
    '(document:mouseup)': 'stop()'
  }
})
export class ReplayPanelResizeDirective {
  readonly width = input.required<number>({ alias: 'codingBoxReplayPanelResize' });
  readonly widthChanged = output<number>();
  readonly resizingChanged = output<boolean>();
  private dragStart: { x: number; width: number } | null = null;

  start(event: MouseEvent): void {
    event.preventDefault();
    this.dragStart = { x: event.clientX, width: this.width() };
    this.resizingChanged.emit(true);
  }

  protected move(event: MouseEvent): void {
    if (!this.dragStart) return;

    const width = this.dragStart.width + this.dragStart.x - event.clientX;
    this.widthChanged.emit(Math.min(window.innerWidth * 0.6, Math.max(250, width)));
  }

  protected stop(): void {
    if (!this.dragStart) return;

    this.dragStart = null;
    this.resizingChanged.emit(false);
  }
}
