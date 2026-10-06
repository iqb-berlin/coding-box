import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { activateOnKeyboard } from './keyboard-activation.util';

@Component({
  standalone: true,
  template: `
    <div role="button" tabindex="0" (click)="activate()"
      (keydown.enter)="onActionKeydown($event)" (keydown.space)="onActionKeydown($event)">
      Custom action
      <input type="checkbox" />
      <button type="button" (click)="$event.stopPropagation()">Nested action</button>
    </div>
  `
})
class KeyboardActivationProbeComponent {
  readonly activate = jest.fn();
  readonly onActionKeydown = activateOnKeyboard;
}

describe('keyboard activation of custom controls', () => {
  it.each(['Enter', ' '])('activates once with %p and consumes only its own key event', key => {
    const fixture = TestBed.createComponent(KeyboardActivationProbeComponent);
    fixture.detectChanges();
    const control = fixture.nativeElement.querySelector('div') as HTMLDivElement;
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    const parentKeydown = jest.fn();
    fixture.nativeElement.addEventListener('keydown', parentKeydown);
    control.dispatchEvent(event);
    control.dispatchEvent(new KeyboardEvent('keydown', {
      key, bubbles: true, cancelable: true, repeat: true
    }));

    expect(fixture.componentInstance.activate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    expect(parentKeydown).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it.each(['input', 'button'])('preserves the native key event of a nested %p', selector => {
    const fixture = TestBed.createComponent(KeyboardActivationProbeComponent);
    fixture.detectChanges();
    const child = fixture.nativeElement.querySelector(selector) as HTMLElement;
    const parentKeydown = jest.fn();
    fixture.nativeElement.addEventListener('keydown', parentKeydown);
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      child.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(parentKeydown).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.activate).not.toHaveBeenCalled();
    fixture.destroy();
  });
});
