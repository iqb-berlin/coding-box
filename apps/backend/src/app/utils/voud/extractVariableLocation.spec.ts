import { extractVariableLocation } from './extractVariableLocation';

describe('VOUD variable locations', () => {
  it('retains keyed paths, inherited visibility and dependency references', () => {
    const unit = {
      definition: JSON.stringify({
        pages: [{
          alwaysVisible: false,
          sections: [{
            elements: [
              {
                id: 'source', alias: 'SOURCE', connectedTo: ['target'], value: { id: 'not-a-variable' }
              },
              { id: 'target' }
            ]
          }]
        }]
      })
    };
    const [result] = extractVariableLocation([unit]);
    expect(result).toBe(unit);
    expect(result).not.toHaveProperty('definition');
    expect(result.variable_pages).toEqual([
      {
        variable_ref: 'SOURCE',
        variable_path: { pages: 0, sections: 0, elements: 0 },
        variable_page_always_visible: false,
        variable_dependencies: [{
          variable_dependency_ref: 'target',
          variable_dependency_path: { pages: 0, sections: 0, elements: 1 },
          variable_dependency_page_always_visible: false
        }]
      },
      {
        variable_ref: 'target',
        variable_path: { pages: 0, sections: 0, elements: 1 },
        variable_page_always_visible: false,
        variable_dependencies: []
      }
    ]);
  });

  it('rejects a missing definition and ignores malformed variable identifiers', () => {
    expect(() => extractVariableLocation([{}])).toThrow('Unit definition must be a JSON string');
    expect(extractVariableLocation([{ definition: JSON.stringify([{ id: 7 }, null]) }])[0].variable_pages).toEqual([]);
  });
});
