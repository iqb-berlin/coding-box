const { Table, TableForeignKey } = require('typeorm');

// Use TypeORM's PostgreSQL schema representation, including inferred column types.
module.exports = source => source.entityMetadatas.map(metadata => {
  const table = Table.create(metadata, source.driver);
  table.foreignKeys = metadata.foreignKeys.map(key => TableForeignKey.create(key, source.driver));
  // Decorator registration order can differ between loaders. Preserve the order
  // inside compound keys/indices, but compare table members by their names.
  for (const key of ['columns', 'indices', 'foreignKeys', 'uniques', 'checks', 'exclusions']) {
    table[key].sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    name: metadata.name,
    table,
    relations: metadata.relations.map(relation => ({
      property: relation.propertyPath,
      target: relation.inverseEntityMetadata.tablePath,
      type: relation.relationType,
      inverse: relation.inverseRelation?.propertyPath,
      nullable: relation.isNullable,
      eager: relation.isEager,
      lazy: relation.isLazy,
      cascade: [relation.isCascadeInsert, relation.isCascadeUpdate, relation.isCascadeRemove,
        relation.isCascadeSoftRemove, relation.isCascadeRecover],
      orphanedRowAction: relation.orphanedRowAction,
      joinColumns: relation.joinColumns.map(column => column.databaseName),
      inverseJoinColumns: relation.inverseJoinColumns.map(column => column.databaseName)
    })).sort((a, b) => a.property.localeCompare(b.property))
  };
}).sort((a, b) => a.name.localeCompare(b.name));
