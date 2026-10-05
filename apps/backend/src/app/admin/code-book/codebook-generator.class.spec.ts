import AdmZip = require('adm-zip');
import { load } from 'cheerio';
import { CodebookGenerator } from './codebook-generator.class';
import type { CodeBookContentSetting } from './codebook.interfaces';

const options: CodeBookContentSetting = {
  exportFormat: 'json',
  missingsProfile: '',
  hasOnlyManualCoding: true,
  hasClosedVars: false,
  hasOnlyVarsWithCodes: true,
  hasDerivedVars: true,
  hasGeneralInstructions: true,
  codeLabelToUpper: false,
  showScore: true,
  hideItemVarRelation: false
};
const coding = (id: string, training = false) => ({
  id,
  alias: `${id}_ALIAS`,
  label: id,
  sourceType: 'BASE',
  processing: training ? ['CODER_TRAINING_REQUIRED'] : [],
  codes: [
    {
      id: 0, label: 'Zero', type: 'FULL_CREDIT', score: 0, ruleSets: [], manualInstruction: '<p>Bewerten</p>'
    },
    {
      id: 1, label: 'Rest', type: 'RESIDUAL_AUTO', score: 0, ruleSets: [], manualInstruction: ''
    }
  ]
});
const unit = {
  id: 1, key: 'U.VOCS', name: 'Unit', scheme: JSON.stringify({ version: '3.0', variableCodings: [coding('A', true), coding('B')] }), metadata: { items: [] }
};

describe('Kodierbox adapter to shared CodebookGenerator', () => {
  it.each([
    {
      name: 'direct list instructions',
      instruction: '<ul><li>Erstes Kriterium</li><li>Zweites Kriterium</li></ul>',
      ruleSets: [],
      expected: ['Erstes Kriterium', 'Zweites Kriterium']
    },
    {
      name: 'plain instructions after generated rule paragraphs',
      instruction: 'Manuelle Instruktion',
      ruleSets: [{ rules: [{ method: 'MATCH', parameters: ['ABC'] }], ruleOperatorAnd: true }],
      expected: ['ABC', 'Manuelle Instruktion']
    }
  ])('retains $name in complete DOCX exports', async ({ instruction, ruleSets, expected }) => {
    const variable = {
      ...coding('V'),
      codes: [{ ...coding('V').codes[0], manualInstruction: instruction, ruleSets }]
    };
    const buffer = await CodebookGenerator.generateCodebook([{
      ...unit,
      scheme: JSON.stringify({ version: '3.0', variableCodings: [variable] })
    }], { ...options, exportFormat: 'docx', hasClosedVars: true }, []);
    const $ = load(new AdmZip(buffer).readAsText('word/document.xml'), { xml: true });
    const paragraphs = $('w\\:tr').first().children('w\\:tc').last()
      .find('w\\:p')
      .toArray()
      .map(paragraph => $(paragraph).find('w\\:t').text());
    expect(paragraphs).toEqual(expected);
  });

  it('keeps the training scope before applying shared manual code filtering', async () => {
    const buffer = await CodebookGenerator.generateCodebook([unit], { ...options, trainingRequirement: 'required' }, []);
    const [result] = JSON.parse(buffer.toString());
    expect(result.key).toBe('U');
    expect(result.variables.map(v => v.id)).toEqual(['A_ALIAS']);
    expect(result.variables[0].codes.map(c => c.id)).toEqual(['0']);
  });

  it('retains all / not-required training choices', async () => {
    for (const [trainingRequirement, count] of [['all', 2], ['not-required', 1]] as const) {
      const buffer = await CodebookGenerator.generateCodebook([unit], { ...options, trainingRequirement }, []);
      expect(JSON.parse(buffer.toString())[0].variables).toHaveLength(count);
    }
  });

  it('returns an empty JSON array and rejects malformed schemes', async () => {
    expect((await CodebookGenerator.generateCodebook([], options, [])).toString()).toBe('[]');
    await expect(CodebookGenerator.generateCodebook([{ ...unit, scheme: '{' }], options, [])).rejects.toThrow();
  });
});
