import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { VariableBundleService } from '../../database/services/coding';
import { VariableBundleController } from './variable-bundle.controller';

describe('VariableBundleController creation errors', () => {
  const createVariableBundle = jest.fn();
  const controller = new VariableBundleController({ createVariableBundle } as unknown as VariableBundleService);

  beforeEach(() => createVariableBundle.mockReset());

  it('preserves an ownership denial and forwards the authenticated actor', async () => {
    const denial = new ForbiddenException('Manager rights required');
    createVariableBundle.mockRejectedValue(denial);
    const dto = { name: 'Denied bundle', variables: [] };

    await expect(controller.createVariableBundle(5, dto, { user: { id: 7 } })).rejects.toBe(denial);
    expect(createVariableBundle).toHaveBeenCalledWith(5, dto, 7);
    expect(denial.getStatus()).toBe(403);
  });

  it('continues to report an unexpected creation failure as a bad request', async () => {
    createVariableBundle.mockRejectedValue(new Error('Invalid bundle'));
    await expect(controller.createVariableBundle(5, { name: 'Bundle', variables: [] }, { user: { id: 7 } }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
