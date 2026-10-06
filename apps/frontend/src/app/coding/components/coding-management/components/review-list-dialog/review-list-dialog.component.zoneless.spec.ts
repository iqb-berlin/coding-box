import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { ReviewListDialogComponent } from './review-list-dialog.component';
import { CodingManagementUiService } from '../../services/coding-management-ui.service';
import { Success } from '../../../../models/success.model';

describe('ReviewListDialogComponent without ZoneJS', () => {
  let fixture: ComponentFixture<ReviewListDialogComponent>;
  let observerCallback: IntersectionObserverCallback;
  let disconnect: jest.Mock;
  let replayResponses: Subject<string>[];
  let openReplayForResponse: jest.Mock;
  let originalObserver: typeof IntersectionObserver;

  const response = (id: number): Success => ({
    id,
    unitid: 10,
    variableid: 'var1',
    status: 'VALUE_CHANGED',
    value: 'UEsD',
    subform: '',
    code: String(id),
    score: null,
    codedstatus: 'CODING_COMPLETE',
    unitname: 'Unit1',
    login_name: `login${id}`
  });

  const idle = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise(resolve => { setTimeout(resolve, 150); });
    await fixture.whenStable();
  };

  const items = (): NodeListOf<HTMLElement> => (fixture.nativeElement as HTMLElement).querySelectorAll('.review-item');
  const makeVisible = (...indices: number[]): void => {
    observerCallback(indices.map(index => ({
      target: items()[index], isIntersecting: true
    } as IntersectionObserverEntry)), {} as IntersectionObserver);
  };

  beforeEach(async () => {
    originalObserver = window.IntersectionObserver;
    disconnect = jest.fn();
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation((callback: IntersectionObserverCallback) => {
        observerCallback = callback;
        return { observe: jest.fn(), disconnect };
      })
    });
    replayResponses = [new Subject<string>(), new Subject<string>(), new Subject<string>()];
    openReplayForResponse = jest.fn()
      .mockReturnValueOnce(replayResponses[0])
      .mockReturnValueOnce(replayResponses[1])
      .mockReturnValueOnce(replayResponses[2]);
    await TestBed.configureTestingModule({
      imports: [ReviewListDialogComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: { responses: [response(1), response(2)] } },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: CodingManagementUiService, useValue: { openReplayForResponse } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(ReviewListDialogComponent);
    fixture.autoDetectChanges();
    await idle();
  });

  afterEach(() => {
    fixture.destroy();
    expect(disconnect).toHaveBeenCalled();
    Object.defineProperty(window, 'IntersectionObserver', { configurable: true, writable: true, value: originalObserver });
  });

  it('renders observer-triggered loading and delayed replays in queue order', async () => {
    makeVisible(0, 1);
    await idle();
    expect(items()[0].querySelector('.loading-overlay')).not.toBeNull();
    expect(items()[1].querySelector('.loading-overlay')).toBeNull();
    expect(openReplayForResponse).toHaveBeenCalledTimes(1);

    replayResponses[0].next('https://example.org/replay/1');
    replayResponses[0].complete();
    await idle();
    expect(items()[0].querySelector('iframe')?.getAttribute('src')).toBe('https://example.org/replay/1');
    expect(items()[0].querySelector('.loading-overlay')).toBeNull();
    expect(items()[1].querySelector('.loading-overlay')).not.toBeNull();
    expect(openReplayForResponse).toHaveBeenCalledTimes(2);

    replayResponses[1].next('https://example.org/replay/2');
    replayResponses[1].complete();
    await fixture.whenStable();
    expect(items()[1].querySelector('iframe')?.getAttribute('src')).toBe('https://example.org/replay/2');
    expect(items()[1].querySelector('.loading-overlay')).toBeNull();
  });

  it.each(['empty URL', 'request error'])('renders a delayed %s and allows retry', async outcome => {
    makeVisible(0);
    await idle();
    if (outcome === 'empty URL') {
      replayResponses[0].next('');
      replayResponses[0].complete();
    } else {
      replayResponses[0].error(new Error('request failed'));
    }
    await fixture.whenStable();
    expect(items()[0].querySelector('.loading-overlay')).toBeNull();
    expect(items()[0].querySelector('.error-overlay')).not.toBeNull();
    expect(openReplayForResponse).toHaveBeenCalledTimes(1);

    items()[0].querySelector<HTMLButtonElement>('.error-overlay button')!.click();
    await idle();
    expect(items()[0].querySelector('.error-overlay')).toBeNull();
    expect(items()[0].querySelector('.loading-overlay')).not.toBeNull();
    replayResponses[1].next('https://example.org/replay/retry');
    replayResponses[1].complete();
    await fixture.whenStable();
    expect(items()[0].querySelector('iframe')?.getAttribute('src')).toBe('https://example.org/replay/retry');
    expect(items()[0].querySelector('.loading-overlay')).toBeNull();
  });
});
