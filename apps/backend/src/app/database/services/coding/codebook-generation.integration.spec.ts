import AdmZip = require('adm-zip');
import { load } from 'cheerio';
import { CodingSchemeFactory } from '@iqb/responses';
import { CodebookGenerationService } from './codebook-generation.service';
import { CodeBookContentSetting } from '../../../admin/code-book/codebook.interfaces';

const contentOptions: CodeBookContentSetting = {
  exportFormat: 'json',
  missingsProfile: '',
  hasOnlyManualCoding: true,
  hasGeneralInstructions: true,
  hasDerivedVars: true,
  hasOnlyVarsWithCodes: true,
  hasClosedVars: false,
  codeLabelToUpper: false,
  showScore: true,
  hideItemVarRelation: false,
  trainingRequirement: 'all'
};

const coding = (id: string, alias: string) => ({
  id,
  alias,
  label: alias,
  sourceType: 'BASE',
  sourceParameters: {},
  deriveSources: [],
  processing: [],
  manualInstruction: '',
  codes: [{
    id: 0,
    type: 'FULL_CREDIT',
    label: 'Richtig',
    score: 0,
    manualInstruction: `<p>Bewerten ${id}</p>`,
    ruleSets: [],
    ruleSetOperatorAnd: true
  }]
});

function itemRelations(buffer: Buffer): string[][] {
  const $ = load(new AdmZip(buffer).readAsText('word/document.xml'), { xml: true });
  return $('w\\:body').children('w\\:p').toArray()
    .map(paragraph => $(paragraph).find('w\\:t').text())
    .filter(text => text.startsWith('Item(s):'))
    .map(text => text.substring('Item(s):'.length).trim().split(/\s+/));
}

describe('CodebookGenerationService with the real shared generator', () => {
  const files = { find: jest.fn() };
  const jobs = { findOne: jest.fn() };
  const bundles = { find: jest.fn() };
  const profiles = { getMissingsProfileDetails: jest.fn() };
  let service: CodebookGenerationService;

  function sourceUnit(legacyItems = false) {
    return {
      id: 1,
      file_id: 'UNIT.VOCS',
      filename: 'Titel.vocs',
      data: JSON.stringify({ version: '3.4', variableCodings: [coding('idA', 'idB'), coding('idB', 'idA')] }),
      structured_data: {
        metadata: {
          items: [
            { id: 'ITEM-A', variableId: 'idA' },
            { id: 'ITEM-B', variableId: 'idB' },
            ...(legacyItems ? [{ key: 'LEGACY-A', idB: 0 }, { key: 'LEGACY-B', idA: false }] : [])
          ]
        }
      }
    };
  }

  beforeEach(() => {
    jest.resetAllMocks();
    service = new CodebookGenerationService(files as never, jobs as never, bundles as never, profiles as never);
    files.find.mockResolvedValue([sourceUnit()]);
    jobs.findOne.mockResolvedValue({
      assigned_variables: [{ unitName: 'UNIT', variableId: 'idB' }],
      assigned_variable_bundles: []
    });
    bundles.find.mockResolvedValue([{ id: 20, variables: [{ unitName: 'UNIT', variableId: 'idB' }] }]);
    const variables = JSON.parse(sourceUnit().data).variableCodings;
    expect(CodingSchemeFactory.validate(variables.map(({ id }: { id: string }) => ({
      id, type: 'STRING', multiple: false, nullable: false, format: '', values: [], valuePositionLabels: []
    })), variables)).toEqual([]);
  });

  it.each([
    {
      name: 'job',
      scope: { jobDefinitionId: 10 },
      alias: 'idB',
      sourceId: 'idA',
      item: 'ITEM-A',
      legacyItems: false
    },
    {
      name: 'bundle',
      scope: { variableBundleIds: [20] },
      alias: 'idB',
      sourceId: 'idA',
      item: 'ITEM-A',
      legacyItems: false
    },
    {
      name: 'job/bundle intersection',
      scope: { jobDefinitionId: 10, variableBundleIds: [20] },
      alias: 'idB',
      sourceId: 'idA',
      item: 'ITEM-A',
      legacyItems: false
    },
    {
      name: 'reverse alias collision',
      scope: { jobDefinitionId: 10 },
      alias: 'idA',
      sourceId: 'idB',
      item: 'ITEM-B',
      legacyItems: false
    },
    {
      name: 'legacy zero column',
      scope: { jobDefinitionId: 10 },
      alias: 'idB',
      sourceId: 'idA',
      item: 'ITEM-A',
      legacyItems: true
    },
    {
      name: 'legacy false column',
      scope: { variableBundleIds: [20] },
      alias: 'idA',
      sourceId: 'idB',
      item: 'ITEM-B',
      legacyItems: true
    }
  ])('keeps original item identities through the $name scope', async ({
    scope, alias, sourceId, item, legacyItems
  }) => {
    files.find.mockResolvedValue([sourceUnit(legacyItems)]);
    jobs.findOne.mockResolvedValue({
      assigned_variables: [{ unitName: 'UNIT', variableId: alias }],
      assigned_variable_bundles: []
    });
    bundles.find.mockResolvedValue([{ id: 20, variables: [{ unitName: 'UNIT', variableId: alias }] }]);
    const json = await service.generateCodebook(42, 0, { ...contentOptions, ...scope }, [1]);
    expect(json).not.toBeNull();
    const [{ variables }] = JSON.parse(json!.toString());
    expect(variables.map(variable => variable.id)).toEqual([alias]);
    expect(variables[0].codes[0]).toMatchObject({ id: '0', score: '0', description: `<p>Bewerten ${sourceId}</p>` });

    const docx = await service.generateCodebook(42, 0, { ...contentOptions, ...scope, exportFormat: 'docx' }, [1]);
    expect(docx).not.toBeNull();
    expect(itemRelations(docx!)).toEqual([[item, ...(legacyItems ? [`LEGACY-${sourceId === 'idA' ? 'A' : 'B'}`] : [])]]);
  });

  it('retains both original item relations without a variable scope', async () => {
    const docx = await service.generateCodebook(42, 0, { ...contentOptions, exportFormat: 'docx' }, [1]);
    expect(docx).not.toBeNull();
    expect(itemRelations(docx!)).toEqual([['ITEM-B'], ['ITEM-A']]);
  });

  it('does not carry a previous export scope into later exports of the same source record', async () => {
    const unit = sourceUnit();
    files.find.mockResolvedValue([unit]);
    for (const [alias, item] of [['idB', 'ITEM-A'], ['idA', 'ITEM-B']]) {
      jobs.findOne.mockResolvedValue({ assigned_variables: [{ unitName: 'UNIT', variableId: alias }], assigned_variable_bundles: [] });
      const docx = await service.generateCodebook(42, 0, { ...contentOptions, exportFormat: 'docx', jobDefinitionId: 10 }, [1]);
      expect(docx).not.toBeNull();
      expect(itemRelations(docx!)).toEqual([[item]]);
    }
    expect(unit).toEqual(sourceUnit());
    const docx = await service.generateCodebook(42, 0, { ...contentOptions, exportFormat: 'docx' }, [1]);
    expect(docx).not.toBeNull();
    expect(itemRelations(docx!)).toEqual([['ITEM-B'], ['ITEM-A']]);
  });
});
