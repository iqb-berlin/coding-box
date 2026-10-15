import {
  defer, EMPTY, filter, MonoTypeOperatorFunction, takeUntil
} from 'rxjs';
import { AppService } from '../../core/services/app.service';

// Cancel on the first context change, including A -> B -> A. Comparing the
// workspace only when an HTTP response arrives would miss that transition.
export function takeUntilWorkspaceChanged<T>(
  appService: Pick<AppService, 'selectedWorkspaceId' | 'selectedWorkspaceId$'>,
  workspaceId = appService.selectedWorkspaceId
): MonoTypeOperatorFunction<T> {
  return source => defer(() => (appService.selectedWorkspaceId !== workspaceId ? EMPTY : source.pipe(
    takeUntil(appService.selectedWorkspaceId$.pipe(filter(id => id !== workspaceId)))
  )));
}
