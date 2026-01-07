import { CodingListService } from './coding-list.service';
import { WorkspacesFacadeService } from '../../workspaces/services/workspaces-facade.service';
import { VocsService } from './vocs.service';
import { VoudService } from './voud.service';

type CodingListServiceHeaderGetter = {
  getHeadersForVersion: (version: 'v1' | 'v2' | 'v3') => string[];
};

describe('CodingListService', () => {
  it('should use CodingItem keys as Excel headers for results-by-version export', () => {
    const workspacesFacadeService = {
      findResponsesForCoding: jest.fn()
    } as unknown as WorkspacesFacadeService;
    const vocsService = {
      getExclusions: jest.fn()
    } as unknown as VocsService;
    const voudService = {
      getVariablePageMap: jest.fn()
    } as unknown as VoudService;

    const service = new CodingListService(
      workspacesFacadeService,
      vocsService,
      voudService
    );

    const headersV1 = (
      service as unknown as CodingListServiceHeaderGetter
    ).getHeadersForVersion('v1');

    expect(headersV1).toEqual(
      expect.arrayContaining([
        'person_login',
        'person_code',
        'person_group',
        'booklet_name'
      ])
    );

    expect(headersV1).not.toEqual(
      expect.arrayContaining([
        'login_name',
        'login_code',
        'login_group',
        'booklet_id'
      ])
    );
  });
});
