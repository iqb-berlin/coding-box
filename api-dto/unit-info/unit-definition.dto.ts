export class UnitDefinitionDto {
  type!: 'Definition' | 'DefinitionRef';
  player!: string;
  editor?: string;
  content!: string;
  lastChange?: Date;
}
