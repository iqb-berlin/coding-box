import { TestBed } from '@angular/core/testing';
import { WorkspaceAdminService } from './workspace-admin.service';
import { TestGroupsInfoDto } from '../../../../../../api-dto/files/test-groups-info.dto';

describe('WorkspaceAdminService', () => {
  let service: WorkspaceAdminService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WorkspaceAdminService]
    });
    service = TestBed.inject(WorkspaceAdminService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('setters and getters', () => {
    it('should store and retrieve auth token', () => {
      service.setLastAuthToken('abc');
      expect(service.getAuthToken()).toBe('abc');
    });

    it('should store and retrieve server', () => {
      service.setLastServer('srv');
      expect(service.getLastServer()).toBe('srv');
    });

    it('should store and retrieve url', () => {
      service.setLastUrl('url');
      expect(service.getLastUrl()).toBe('url');
    });

    it('should store and retrieve test groups', () => {
      const groups: TestGroupsInfoDto[] = [{
        groupName: 'g1',
        groupLabel: 'G',
        bookletsStarted: 0,
        numUnitsMin: 0,
        numUnitsMax: 0,
        numUnitsTotal: 0,
        numUnitsAvg: 0,
        lastChange: 0
      }];
      service.setTestGroups(groups);
      expect(service.getTestGroups()).toBe(groups);
    });
  });
});
