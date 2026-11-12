import { viewRefreshEvents } from './view-refresh';

describe('visible view refresh', () => {
  it('refreshes periodically and on return, skips hidden tabs and releases listeners', () => {
    jest.useFakeTimers();
    const visible = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const refresh = jest.fn();
    const subscription = viewRefreshEvents().subscribe(refresh);
    try {
      jest.advanceTimersByTime(30_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      visible.mockReturnValue('hidden');
      jest.advanceTimersByTime(30_000);
      window.dispatchEvent(new Event('focus'));
      expect(refresh).toHaveBeenCalledTimes(1);
      visible.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(refresh).toHaveBeenCalledTimes(2);
      window.dispatchEvent(new Event('focus'));
      expect(refresh).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(1000);
      window.dispatchEvent(new Event('online'));
      expect(refresh).toHaveBeenCalledTimes(3);
      subscription.unsubscribe();
      jest.advanceTimersByTime(60_000);
      window.dispatchEvent(new Event('focus'));
      expect(refresh).toHaveBeenCalledTimes(3);
    } finally {
      subscription.unsubscribe();
      visible.mockRestore();
      jest.useRealTimers();
    }
  });
});
