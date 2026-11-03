export interface ReplayKeyboardState {
  key: string;
  inputFocused: boolean;
  authenticationBlocked: boolean;
  codingMode: boolean;
  currentIndex: number;
  unitCount: number;
  hasNavigationVariable: boolean;
  hasEditableVariable: boolean;
  hasSelection: boolean;
  saveFailed: boolean;
  readOnly: boolean;
}

export interface ReplayKeyboardAction {
  preventDefault: boolean;
  blurInput?: boolean;
  targetIndex?: number;
  codeId?: number;
}

/** Decides keyboard intent; the component owns focus, rendering and event emission. */
export function replayKeyboardAction(state: ReplayKeyboardState): ReplayKeyboardAction {
  if (state.inputFocused) {
    return { preventDefault: state.key === 'Enter', blurInput: state.key === 'Enter' };
  }
  if (state.authenticationBlocked && ['Enter', 'ArrowRight', 'ArrowLeft'].includes(state.key)) {
    return { preventDefault: true };
  }
  if (!state.codingMode) return { preventDefault: false };
  const next = () => ({
    preventDefault: true,
    ...(state.currentIndex + 1 < state.unitCount ? { targetIndex: state.currentIndex + 1 } : {})
  });
  if (state.key === 'Enter' && state.hasNavigationVariable) {
    if (state.saveFailed) return { preventDefault: true };
    return state.hasSelection ? next() : { preventDefault: false };
  }
  if (state.key === 'ArrowRight') {
    return !state.saveFailed && (state.hasSelection || state.readOnly) ? next() : { preventDefault: true };
  }
  if (state.key === 'ArrowLeft' && state.currentIndex > 0) {
    return { preventDefault: true, targetIndex: state.currentIndex - 1 };
  }
  if (/^[0-9]$/.test(state.key) && state.hasEditableVariable && !state.readOnly) {
    return { preventDefault: true, codeId: Number(state.key) };
  }
  return { preventDefault: false };
}
