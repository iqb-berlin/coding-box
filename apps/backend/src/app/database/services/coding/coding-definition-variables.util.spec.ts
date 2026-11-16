import { getDefinitionVariables, loadDefinitionBundles } from './coding-definition-variables.util';
import { JobDefinition } from '../../entities/job-definition.entity';

describe('Definition bundle loading', () => {
  it('loads shared bundles once, scopes them to the workspace and keeps direct variables', async () => {
    const bundle = { id: 7, variables: [{ unitName: 'U', variableId: 'bundle' }] };
    const repository = { find: jest.fn().mockResolvedValue([bundle]) };
    const definitions = [
      { assigned_variables: [{ unitName: 'U', variableId: 'direct' }], assigned_variable_bundles: [{ id: 7 }] },
      { assigned_variable_bundles: [{ id: 7 }, { id: 99 }] }
    ] as JobDefinition[];
    const bundles = await loadDefinitionBundles(repository as never, definitions, 5);
    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(repository.find).toHaveBeenCalledWith({ where: { id: expect.anything(), workspace_id: 5 } });
    expect(getDefinitionVariables(definitions[0], bundles)).toEqual([
      { unitName: 'U', variableId: 'direct' }, ...bundle.variables
    ]);
    expect(getDefinitionVariables(definitions[1], bundles)).toEqual(bundle.variables);
  });

  it('does not issue an unfiltered query for an empty bundle selection', async () => {
    const repository = { find: jest.fn() };
    expect(await loadDefinitionBundles(repository as never, [], 5)).toEqual(new Map());
    expect(repository.find).not.toHaveBeenCalled();
  });
});
