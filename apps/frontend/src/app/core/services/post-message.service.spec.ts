import { TestBed } from '@angular/core/testing';
import { PostMessageService } from './post-message.service';

describe('PostMessageService', () => {
  let service: PostMessageService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PostMessageService]
    });
    service = TestBed.inject(PostMessageService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('removes the global listener and completes its stream on destruction', () => {
    const remove = jest.spyOn(window, 'removeEventListener');
    const received = jest.fn();
    const completed = jest.fn();
    service.messages$.subscribe({ next: received, complete: completed });
    service.ngOnDestroy();
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'late' } }));
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
    expect(received).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledTimes(1);
    remove.mockRestore();
  });

  describe('sendMessage', () => {
    it('should send post message', () => {
      // Mock window.postMessage? Or just spy on it?
      // Since wrapping window.parent, might be tricky to test side effect fully,
      // but we can verify it doesn't crash.
      const spy = jest.spyOn(window, 'postMessage').mockImplementation(() => {});
      const result = service.sendMessage({ type: 'test' }, window);
      expect(result).toBe(true);
      expect(spy).toHaveBeenCalledWith({ type: 'test' }, '*');
    });
  });

  describe('getMessages', () => {
    it('ignores malformed messages without terminating existing subscribers', () => {
      const received = jest.fn();
      const failed = jest.fn();
      service.getMessages('test').subscribe({ next: received, error: failed });
      for (const data of [null, undefined, [], 'test', 1, {}, { type: null }, { type: 1 }, { type: '' }]) {
        window.dispatchEvent(new MessageEvent('message', { data }));
      }
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'test' } }));
      expect(failed).not.toHaveBeenCalled();
      expect(received).toHaveBeenCalledTimes(1);
    });

    it('should include the message origin', done => {
      service.getMessages('test').subscribe(event => {
        expect(event.message).toEqual({ type: 'test' });
        expect(event.origin).toBe('https://example.test');
        done();
      });

      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'test' },
        origin: 'https://example.test'
      }));
    });
  });

  describe('generateSessionId', () => {
    it('should generate numeric string', () => {
      const id = service.generateSessionId();
      expect(id).toMatch(/^\d+$/);
    });
  });
});
