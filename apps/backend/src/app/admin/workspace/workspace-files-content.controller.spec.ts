import { NotFoundException } from '@nestjs/common';
import { WorkspaceFilesContentController } from './workspace-files-content.controller';

describe('Coding scheme download boundary', () => {
  it('returns a not-found error when the repository has no matching coding scheme', async () => {
    const getCodingSchemeByRef = jest.fn().mockResolvedValue(null);
    const controller = new WorkspaceFilesContentController({ getCodingSchemeByRef } as never);
    await expect(controller.getCodingSchemeFile(47, 'missing.vocs')).rejects.toBeInstanceOf(NotFoundException);
    expect(getCodingSchemeByRef).toHaveBeenCalledWith(47, 'missing.vocs');
  });
});
