import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

@Injectable()
export class WorkspaceEventsService {
  private readonly testFilesChangedSubject = new Subject<number>();

  get testFilesChanged$() {
    return this.testFilesChangedSubject.asObservable();
  }

  notifyTestFilesChanged(workspaceId: number): void {
    this.testFilesChangedSubject.next(workspaceId);
  }
}
