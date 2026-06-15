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
