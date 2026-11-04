import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { GermanTranslationsTestingModule } from '../../../../testing/german-translations';
import { SERVER_URL } from '../../../injection-tokens';
import { WorkspaceSettingsService } from './workspace-settings.service';
import { WorkspaceSettingsWriteQueueService } from './workspace-settings-write-queue.service';

describe('WorkspaceSettingsWriteQueueService', () => {
  let queue: WorkspaceSettingsWriteQueueService;
  let settings: WorkspaceSettingsService;
  let http: HttpTestingController;
  const url = 'http://localhost/api/workspace/1/settings';

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [GermanTranslationsTestingModule],
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: 'http://localhost/api' }
      ]
    });
    queue = TestBed.inject(WorkspaceSettingsWriteQueueService);
    settings = TestBed.inject(WorkspaceSettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('finishes ordered HTTP writes after every view consumer unsubscribes and invalidates cached reads', () => {
    settings.getEnableRegexSearch(1).subscribe();
    http.expectOne(`${url}/enable-regex-search`).flush({ value: '{"enabled":false}' });
    const first = queue.enqueue(1, id => settings.setEnableRegexSearch(id, true)).subscribe();
    const second = queue.enqueue(1, id => settings.setEnableRegexSearch(id, false)).subscribe();
    const request = http.expectOne(url);
    expect(JSON.parse(request.request.body.value).enabled).toBe(true);
    first.unsubscribe();
    second.unsubscribe();
    expect(request.cancelled).toBe(false);
    let idle = false;
    queue.whenIdle(1).subscribe(() => { idle = true; });
    expect(idle).toBe(false);
    request.flush({ value: '{"enabled":true}' });
    const last = http.expectOne(url);
    expect(JSON.parse(last.request.body.value).enabled).toBe(false);
    expect(idle).toBe(false);
    last.flush({ value: '{"enabled":false}' });
    expect(idle).toBe(true);
    settings.getEnableRegexSearch(1).subscribe();
    http.expectOne(`${url}/enable-regex-search`).flush({ value: '{"enabled":false}' });
  });

  it('continues after a failed write and keeps each queued workspace ID', () => {
    const error = jest.fn();
    queue.enqueue(1, id => settings.setEnableRegexSearch(id, true)).subscribe({ error });
    queue.enqueue(2, id => settings.setEnableRegexSearch(id, false));
    let firstIdle = false;
    let secondIdle = false;
    queue.whenIdle(1).subscribe(() => { firstIdle = true; });
    queue.whenIdle(2).subscribe(() => { secondIdle = true; });
    http.expectOne(url).flush({}, { status: 500, statusText: 'Failed' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(firstIdle).toBe(true);
    expect(secondIdle).toBe(false);
    http.expectOne('http://localhost/api/workspace/2/settings').flush({});
    expect(secondIdle).toBe(true);
  });
});
