import 'reflect-metadata';
import { InjectionToken, Type } from '@nestjs/common';
import { MODULE_METADATA, PARAMTYPES_METADATA, SELF_DECLARED_DEPS_METADATA } from '@nestjs/common/constants';
import { CodingModule } from '../../../coding/coding.module';
import { WorkspaceModule } from '../../../workspace/workspace.module';
import { WorkspaceDataModule } from '../../../workspace/workspace-data.module';

function assertAcyclic<T>(nodes: T[], dependencies: (node: T) => T[], label: (node: T) => string): void {
  const completed = new Set<T>();
  const active: T[] = [];
  const visit = (node: T) => {
    if (active.includes(node)) throw new Error(`Dependency cycle: ${[...active, node].map(label).join(' -> ')}`);
    if (completed.has(node)) return;
    active.push(node);
    dependencies(node).filter(dependency => nodes.includes(dependency)).forEach(visit);
    active.pop();
    completed.add(node);
  };
  nodes.forEach(visit);
}

describe('workspace and coding dependency direction', () => {
  const modules = [WorkspaceModule, CodingModule, WorkspaceDataModule];

  it('keeps workspace data below coding and workspace workflows in the module graph', () => {
    const imports = (module: Type<unknown>) => Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) as Type<unknown>[];
    expect(imports(WorkspaceModule)).toContain(CodingModule);
    expect(imports(CodingModule)).toContain(WorkspaceDataModule);
    expect(imports(CodingModule)).not.toContain(WorkspaceModule);
    expect(imports(WorkspaceDataModule)).not.toContain(CodingModule);
    expect(imports(WorkspaceDataModule)).not.toContain(WorkspaceModule);
    assertAcyclic<Type<unknown>>(modules, imports, module => module.name);
  });

  it('has no hidden provider cycles through shared ports or cache invalidators', () => {
    const registrations = modules.flatMap(module => Reflect.getMetadata(MODULE_METADATA.PROVIDERS, module));
    const providers = registrations.filter(provider => typeof provider === 'function') as Type<unknown>[];
    const aliases = new Map<InjectionToken, InjectionToken>(registrations
      .filter(provider => provider.useExisting)
      .map(provider => [provider.provide, provider.useExisting]));
    const dependencies = (provider: Type<unknown>): Type<unknown>[] => {
      const parameters: InjectionToken[] = [...(Reflect.getMetadata(PARAMTYPES_METADATA, provider) || [])];
      const overrides: { index: number; param: InjectionToken }[] = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, provider) || [];
      overrides.forEach(({ index, param }) => { parameters[index] = param; });
      expect(parameters).not.toContain(undefined);
      return parameters.map(token => {
        expect(token).not.toHaveProperty('forwardRef');
        return aliases.get(token) || token;
      }).filter(token => providers.includes(token as Type<unknown>)) as Type<unknown>[];
    };
    expect(new Set(providers).size).toBe(providers.length);
    assertAcyclic(providers, dependencies, provider => provider.name);
  });
});
