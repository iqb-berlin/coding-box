import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { EntityA } from './fixtures/entity-a';
import { EntityB } from './fixtures/entity-b';
import { source } from './fixtures/glob-test.factory';

describe('test-only entity decorator metadata', () => {
  it('loads cyclic relation modules without losing explicit TypeORM relation targets', () => {
    expect(Reflect.getMetadata('design:type', EntityA.prototype, 'related')).toBe(Object);
    expect(Reflect.getMetadata('design:type', EntityB.prototype, 'related')).toBe(Object);
    const relation = getMetadataArgsStorage().relations.find(r => r.target === EntityA && r.propertyName === 'related')!;
    expect((relation.type as () => unknown)()).toBe(EntityB);
  });
  it('uses actual entity constructors in plain test factories and builds their metadata offline', async () => {
    expect((source.options.entities as Function[]).every(entity => typeof entity === 'function')).toBe(true);
    await (source as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();
    expect(source.entityMetadatas.some(entity => entity.tableName === 'workspace')).toBe(true);
  });
});
