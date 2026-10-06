/** Activate a custom control while preserving native keyboard behavior of its children. */
export function activateOnKeyboard(event: Event): void {
  const keyboardEvent = event as KeyboardEvent;
  if ((keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') ||
    event.target !== event.currentTarget || !(event.currentTarget instanceof HTMLElement)) {
    return;
  }

  event.stopPropagation();
  event.preventDefault();
  if (!keyboardEvent.repeat) {
    event.currentTarget.click();
  }
}
