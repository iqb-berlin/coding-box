import { PARAMTYPES_METADATA } from '@nestjs/common/constants';
import { NotFoundException } from '@nestjs/common';
import { createRequestValidationPipe } from '../../http/request-validation';
import { WorkspaceFilesContentController } from './workspace-files-content.controller';

describe('Coding scheme download boundary', () => {
  it('accepts alphanumeric unit file identifiers through the request validation pipe', async () => {
    const getUnitContent = jest.fn().mockResolvedValue('<Unit/>');
    const controller = new WorkspaceFilesContentController({ getUnitContent } as never);
    const [, metatype] = Reflect.getMetadata(PARAMTYPES_METADATA, controller, 'getUnitContent');
    const unitId = await createRequestValidationPipe().transform('MMV031', { type: 'param', data: 'unit_id', metatype });
    await expect(controller.getUnitContent(23, String(unitId))).resolves.toEqual({ content: '<Unit/>' });
    expect(getUnitContent).toHaveBeenCalledWith(23, 'MMV031');
  });

  it('returns a not-found error when the repository has no matching coding scheme', async () => {
    const getCodingSchemeByRef = jest.fn().mockResolvedValue(null);
    const controller = new WorkspaceFilesContentController({ getCodingSchemeByRef } as never);
    await expect(controller.getCodingSchemeFile(47, 'missing.vocs')).rejects.toBeInstanceOf(NotFoundException);
    expect(getCodingSchemeByRef).toHaveBeenCalledWith(47, 'missing.vocs');
  });
});
