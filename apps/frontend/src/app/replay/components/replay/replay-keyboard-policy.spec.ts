import { ReplayKeyboardState, replayKeyboardAction } from './replay-keyboard-policy';

describe('replay keyboard policy', () => {
  const state: ReplayKeyboardState = {
    key: 'ArrowRight', inputFocused: false, authenticationBlocked: false, codingMode: true, currentIndex: 0, unitCount: 2, hasNavigationVariable: true, hasEditableVariable: true, hasSelection: true, saveFailed: false, readOnly: false
  };
  it('keeps form editing and authentication ahead of navigation', () => {
    expect(replayKeyboardAction({ ...state, inputFocused: true })).toEqual({ preventDefault: false, blurInput: false });
    expect(replayKeyboardAction({ ...state, inputFocused: true, key: 'Enter' })).toEqual({ preventDefault: true, blurInput: true });
    expect(replayKeyboardAction({ ...state, authenticationBlocked: true })).toEqual({ preventDefault: true });
  });
  it('blocks forward navigation after failed saves but permits going back', () => {
    expect(replayKeyboardAction({ ...state, saveFailed: true })).toEqual({ preventDefault: true });
    expect(replayKeyboardAction({
      ...state, currentIndex: 1, saveFailed: true, key: 'ArrowLeft'
    })).toEqual({ preventDefault: true, targetIndex: 0 });
    expect(replayKeyboardAction({ ...state, currentIndex: 1 })).toEqual({ preventDefault: true });
  });
  it('permits read-only navigation without selection and restricts numeric editing', () => {
    expect(replayKeyboardAction({ ...state, readOnly: true, hasSelection: false })).toEqual({ preventDefault: true, targetIndex: 1 });
    expect(replayKeyboardAction({ ...state, key: '0' })).toEqual({ preventDefault: true, codeId: 0 });
    expect(replayKeyboardAction({ ...state, key: '0', readOnly: true })).toEqual({ preventDefault: false });
    expect(replayKeyboardAction({ ...state, key: '0', hasEditableVariable: false })).toEqual({ preventDefault: false });
    expect(replayKeyboardAction({ ...state, key: 'Enter', hasSelection: false })).toEqual({ preventDefault: false });
  });
});
