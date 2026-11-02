import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { GermanTranslationsTestingModule } from '../../../../testing/german-translations';
import { AppService } from '../../../core/services/app.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { FileValidationProgressFacade } from './file-validation-progress.facade';

describe('file validation progress facade', () => {
  const task: ValidationTaskDto = {
    id: 3, workspace_id: 1, validation_type: 'testFiles', status: 'processing', progress: 20, created_at: new Date(), updated_at: new Date()
  };
  let workspace: BehaviorSubject<number>;
  let backend: { getValidationTask: jest.Mock };
  let facade: FileValidationProgressFacade;
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'requestAnimationFrame'] });
    workspace = new BehaviorSubject(1);
    backend = { getValidationTask: jest.fn() };
    TestBed.configureTestingModule({
      imports: [GermanTranslationsTestingModule],
      providers: [FileValidationProgressFacade,
        { provide: ValidationService, useValue: backend },
        { provide: AppService, useValue: { get selectedWorkspaceId() { return workspace.value; }, selectedWorkspaceId$: workspace } }]
    });
    facade = TestBed.inject(FileValidationProgressFacade);
  });

  afterEach(() => { TestBed.resetTestingModule(); jest.useRealTimers(); });

  it('lets slow polls finish, keeps progress monotonic and stops on completion', () => {
    const slow = new Subject<ValidationTaskDto>();
    backend.getValidationTask.mockReturnValueOnce(slow).mockReturnValue(of({ ...task, status: 'completed', progress: 100 }));
    const completed = jest.fn();
    facade.watch(1, task).subscribe(completed);
    jest.advanceTimersByTime(900);
    expect(backend.getValidationTask).toHaveBeenCalledTimes(1);
    slow.next({ ...task, progress: 10 });
    expect(facade.progress()).toBe(20);
    slow.complete();
    jest.advanceTimersByTime(300);
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(facade.progress()).toBe(100);
    jest.advanceTimersByTime(900);
    expect(backend.getValidationTask).toHaveBeenCalledTimes(2);
  });

  it('cancels on the first workspace switch, including switching back', () => {
    const slow = new Subject<ValidationTaskDto>();
    backend.getValidationTask.mockReturnValue(slow);
    const received = jest.fn();
    facade.watch(1, task).subscribe(received);
    jest.advanceTimersByTime(0);
    workspace.next(2);
    workspace.next(1);
    slow.next({ ...task, status: 'completed', progress: 100 });
    jest.advanceTimersByTime(900);
    expect(received).not.toHaveBeenCalled();
    expect(facade.progress()).toBe(20);
    expect(backend.getValidationTask).toHaveBeenCalledTimes(1);
  });

  it('replaces an old poll when starting a new validation', () => {
    const slow = new Subject<ValidationTaskDto>();
    backend.getValidationTask.mockReturnValue(slow);
    facade.watch(1, task).subscribe();
    jest.advanceTimersByTime(0);
    facade.start('Next validation');
    expect(slow.observed).toBe(false);
    expect(facade.progress()).toBe(0);
    expect(facade.message()).toBe('Next validation');
    jest.advanceTimersByTime(900);
    expect(backend.getValidationTask).toHaveBeenCalledTimes(1);
  });
});
