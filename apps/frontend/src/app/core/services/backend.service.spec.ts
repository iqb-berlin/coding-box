import { TestBed } from '@angular/core/testing';
import { BackendService } from './backend.service';
import { SERVER_URL } from '../../injection-tokens';

describe('BackendService', () => {
  let service: BackendService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BackendService,
        { provide: SERVER_URL, useValue: 'http://test-server' }
      ]
    });
    service = TestBed.inject(BackendService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
