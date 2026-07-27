import { getJobDefinitionDisplayLabel } from './job-definition-display.util';

describe('getJobDefinitionDisplayLabel', () => {
  it('shows the user-facing name together with the stable id', () => {
    expect(getJobDefinitionDisplayLabel({ id: 42, name: 'Lesen Klasse 4' }))
      .toBe('Lesen Klasse 4 (#42)');
  });

  it('does not duplicate the id for an exact migrated legacy name', () => {
    expect(getJobDefinitionDisplayLabel({ id: 42, name: '  Definition #42  ' }))
      .toBe('Definition #42');
  });

  it('keeps the id visible when a legacy-looking name refers to another id', () => {
    expect(getJobDefinitionDisplayLabel({ id: 42, name: 'Definition #41' }))
      .toBe('Definition #41 (#42)');
  });

  it('falls back to the legacy id label when the name is missing', () => {
    expect(getJobDefinitionDisplayLabel({ id: 42, name: '   ' }))
      .toBe('Definition #42');
  });

  it('supports unsaved definitions without an id', () => {
    expect(getJobDefinitionDisplayLabel({ name: 'Lesen Klasse 4' }))
      .toBe('Lesen Klasse 4');
  });
});
