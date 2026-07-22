export class AutocoderPersistenceTargetCollisionError extends Error {
  constructor(
    target: string,
    firstResultIndex: number,
    secondResultIndex: number
  ) {
    super(
      `Autocoder produced multiple updates for ${target} ` +
      `(results ${firstResultIndex + 1} and ${secondResultIndex + 1}).`
    );
    this.name = AutocoderPersistenceTargetCollisionError.name;
  }
}
