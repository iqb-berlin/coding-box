import { Subject, of } from 'rxjs';
import { deleteBookletsSequentially } from './delete-booklets-sequentially';

describe('deleteBookletsSequentially', () => {
  it('continues after failed requests and reports the total after the last booklet', () => {
    const first = new Subject<{ success: boolean }>();
    const remove = jest.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(of({ success: false }))
      .mockReturnValueOnce(of({ success: true }));
    const report = jest.fn();

    deleteBookletsSequentially([4, 5, 6], remove).subscribe(report);
    expect(remove.mock.calls).toEqual([[4]]);
    first.error(new Error('Booklet could not be deleted'));

    expect(remove.mock.calls).toEqual([[4], [5], [6]]);
    expect(report).toHaveBeenCalledWith({ successCount: 1, failCount: 2 });
  });

  it('leaves queued requests untouched when the subscriber cancels', () => {
    const first = new Subject<{ success: boolean }>();
    const remove = jest.fn(() => first);
    const report = jest.fn();
    const subscription = deleteBookletsSequentially([4, 5], remove).subscribe(report);

    subscription.unsubscribe();
    first.next({ success: true });
    first.complete();

    expect(remove.mock.calls).toEqual([[4]]);
    expect(report).not.toHaveBeenCalled();
  });
});
