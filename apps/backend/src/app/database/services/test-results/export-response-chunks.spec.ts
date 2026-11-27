import { ResponseEntity } from '../../entities/response.entity';
import { exportResponseChunks } from './export-response-chunks';

describe('CSV response values', () => {
  it.each([
    { stored: '[{"a":1}]', expected: '[{"a":1}]' },
    { stored: '[[1]]', expected: '[[1]]' },
    { stored: '[1,"two",null,true]', expected: [1, 'two', null, true] }
  ])('exports the response value $stored from an ordinary input', ({ stored, expected }) => {
    const row = Object.assign(new ResponseEntity(), {
      variableid: 'input_1', source_chunk_key: 'page', status: 3, value: stored
    });
    const [chunk] = exportResponseChunks([row], []);
    expect(JSON.parse(chunk.content)[0].value).toEqual(expected);
  });

  it.each([
    { stored: '["2-2-#f9f871"]', expected: ['2-2-#f9f871'] },
    { stored: '[["2-2-#f9f871"]]', expected: [['2-2-#f9f871']] },
    { stored: '[ "2-2-#f9f871" ]', expected: '[ "2-2-#f9f871" ]' },
    { stored: '{"marks":[]}', expected: '{"marks":[]}' },
    { stored: '[unfinished', expected: '[unfinished' },
    { stored: '  ', expected: '  ' },
    { stored: null, expected: null }
  ])('preserves the stored marking-panel value $stored', ({ stored, expected }) => {
    const row = Object.assign(new ResponseEntity(), {
      variableid: 'marking-panel_1', source_chunk_key: 'page', status: 3, value: stored
    });
    const [chunk] = exportResponseChunks([row], []);
    expect(JSON.parse(chunk.content)).toEqual([{ id: 'marking-panel_1', value: expected, status: 'VALUE_CHANGED' }]);
  });
});
