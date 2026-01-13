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

  describe('generateSessionId', () => {
    it('should generate numeric string', () => {
      const id = service.generateSessionId();
      expect(id).toMatch(/^\d+$/);
    });
  });
});
