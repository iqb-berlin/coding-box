import { NotFoundException } from '@nestjs/common';
import { VariableBundleService } from './variable-bundle.service';

const createRepo = () => ({
  count: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(value => value),
  save: jest.fn(value => Promise.resolve(value)),
  remove: jest.fn()
});

describe('VariableBundleService', () => {
  let repo: ReturnType<typeof createRepo>;
  let service: VariableBundleService;

  beforeEach(() => {
    repo = createRepo();
    service = new VariableBundleService(repo as never);
  });

  it('lists bundles with sanitized paging', async () => {
    repo.count.mockResolvedValue(1);
    repo.find.mockResolvedValue([{ id: 1 }]);

    await expect(service.getVariableBundles(3, 0, 0)).resolves.toEqual({
      data: [{ id: 1 }],
      total: 1,
      page: 1,
      limit: 10
    });
  });

  it('gets, creates, updates and deletes bundles', async () => {
    repo.findOne.mockResolvedValue({ id: 1, workspace_id: 3, variables: [] });

    await expect(service.getVariableBundle(1, 3)).resolves.toEqual({ id: 1, workspace_id: 3, variables: [] });
    await expect(service.createVariableBundle(3, {
      name: 'Bundle',
      variables: [{ unitName: 'U', variableId: 'V' }]
    })).resolves.toMatchObject({ name: 'Bundle', workspace_id: 3 });
    await expect(service.updateVariableBundle(1, 3, { name: 'Renamed' } as never)).resolves.toMatchObject({ name: 'Renamed' });
    await expect(service.deleteVariableBundle(1, 3)).resolves.toEqual({ success: true });
  });

  it('throws for missing bundles', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.getVariableBundle(99, 3)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('adds and removes variables without duplicating entries', async () => {
    const bundle = { id: 1, variables: [{ unitName: 'U', variableId: 'V' }] };
    repo.findOne.mockResolvedValue(bundle);

    await expect(service.addVariableToBundle(1, 3, { unitName: 'U', variableId: 'V' })).resolves.toBe(bundle);
    await expect(service.addVariableToBundle(1, 3, { unitName: 'U2', variableId: 'V2' })).resolves.toMatchObject({
      variables: [{ unitName: 'U', variableId: 'V' }, { unitName: 'U2', variableId: 'V2' }]
    });
    await expect(service.removeVariableFromBundle(1, 3, 'U', 'V')).resolves.toMatchObject({
      variables: [{ unitName: 'U2', variableId: 'V2' }]
    });
  });
});
