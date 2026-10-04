import { Observable, Subject } from 'rxjs';
import { takeUntilWorkspaceChanged } from './workspace-request.operator';

describe('Workspace request cancellation', () => {
  it('cancels on the first workspace change even when the user immediately returns', () => {
    const changes = new Subject<number>();
    const workspace = { selectedWorkspaceId: 5, selectedWorkspaceId$: changes };
    const reply = new Subject<string>();
    const received: string[] = [];
    const teardown = jest.fn();
    new Observable<string>(subscriber => {
      const subscription = reply.subscribe(subscriber);
      return () => { teardown(); subscription.unsubscribe(); };
    }).pipe(takeUntilWorkspaceChanged(workspace)).subscribe(value => received.push(value));

    changes.next(5);
    reply.next('current');
    expect(received).toEqual(['current']);
    workspace.selectedWorkspaceId = 6;
    changes.next(6);
    workspace.selectedWorkspaceId = 5;
    changes.next(5);
    reply.next('stale');

    expect(received).toEqual(['current']);
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(reply.observed).toBe(false);
    expect(changes.observed).toBe(false);
  });

  it('does not start a request whose captured context has already changed', () => {
    const workspace = { selectedWorkspaceId: 6, selectedWorkspaceId$: new Subject<number>() };
    const start = jest.fn();
    new Observable(start).pipe(takeUntilWorkspaceChanged(workspace, 5)).subscribe();
    expect(start).not.toHaveBeenCalled();
  });
});
