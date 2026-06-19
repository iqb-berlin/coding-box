import { CodebookGenerator } from './codebook-generator.class';

const contentSetting = {
  exportFormat: 'json',
  hasDerivedVars: false,
  hasOnlyVarsWithCodes: false,
  hasOnlyManualCoding: false,
  hasClosedVars: true,
  hasGeneralInstructions: true,
  codeLabelToUpper: false,
  showScore: true
};

const manualCode = {
  id: 1,
  label: 'Code A',
  score: 1,
  type: 'FULL_CREDIT',
  manualInstruction: '<p>manual</p>',
  ruleSet: []
};

const closedCode = {
  id: 2,
  label: 'Closed',
  score: 0,
  type: 'RESIDUAL_AUTO',
  manualInstruction: '',
  ruleSet: []
};

const variableCoding = {
  id: 'VAR',
  alias: 'ALIAS',
  label: 'Variable',
  sourceType: 'BASE',
  manualInstruction: '<p>general</p>',
  codes: [manualCode, closedCode]
};

describe('CodebookGenerator', () => {
  it('returns an empty json buffer for empty codebooks', async () => {
    await expect(CodebookGenerator.generateCodebook([], contentSetting as never, []))
      .resolves.toEqual(Buffer.from('[]', 'utf-8'));
  });

  it('formats and filters book variables and codes', () => {
    const generator = CodebookGenerator as unknown as Record<string, (...args: unknown[]) => unknown>;

    expect(generator.getSortedBookVariables([
      { id: 'B', sourceType: 'BASE', codes: [] },
      { id: 'A', sourceType: 'BASE', codes: [] }
    ])).toEqual([
      { id: 'A', sourceType: 'BASE', codes: [] },
      { id: 'B', sourceType: 'BASE', codes: [] }
    ]);

    expect(generator.isClosed(variableCoding)).toBe(true);
    expect(generator.isManual(variableCoding)).toBe(true);
    expect(generator.isManualWithoutClosed(variableCoding)).toBe(true);
    expect(generator.isClosedWithoutManual(variableCoding)).toBe(true);

    const baseVariable = generator.getBaseOrDerivedBookVariable(variableCoding, contentSetting);
    expect(baseVariable).toMatchObject({ id: 'ALIAS', label: 'Variable' });

    const derivedVariable = generator.getBaseOrDerivedBookVariable(
      { ...variableCoding, sourceType: 'DERIVE' },
      { ...contentSetting, hasDerivedVars: false }
    );
    expect(derivedVariable).toBeNull();

    expect(generator.getManualOrClosedCodedBookVariable(
      { ...contentSetting, hasOnlyVarsWithCodes: true },
      [],
      variableCoding
    )).toBeNull();

    expect(generator.getManualOrClosedCodedBookVariable(
      { ...contentSetting, hasOnlyManualCoding: true, hasClosedVars: false },
      [],
      { ...variableCoding, codes: [closedCode] }
    )).toBeNull();

    expect(generator.getManualOrClosedCodedBookVariable(
      { ...contentSetting, hasOnlyManualCoding: true, hasClosedVars: true },
      [],
      { ...variableCoding, codes: [{ ...closedCode, manualInstruction: '' }] }
    )).toBeNull();

    expect(generator.getManualOrClosedCodedBookVariable(
      { ...contentSetting, hasClosedVars: false },
      [],
      { ...variableCoding, codes: [closedCode] }
    )).toBeNull();
  });

  it('builds code information fallbacks and rule descriptions', () => {
    const generator = CodebookGenerator as unknown as Record<string, (...args: unknown[]) => unknown>;

    expect(generator.getCodeInfo({ id: 5 }, { ...contentSetting, showScore: true }))
      .toMatchObject({ id: '5', score: '' });

    expect(generator.getRulesDescription(
      { ruleSetDescriptions: ['Keine Regeln definiert.', 'Regel A'] },
      { manualInstruction: '' }
    )).toContain('Regel A');

    const codeInfos = generator.getCodes(
      [
        { ...manualCode, id: 1 },
        { id: 0 },
        { ...manualCode, id: 3, ruleSet: undefined }
      ],
      { ...contentSetting, codeLabelToUpper: true }
    ) as { id: string }[];
    expect(Array.isArray(codeInfos)).toBe(true);
    expect(codeInfos.length).toBeGreaterThan(0);
    expect(codeInfos.map(codeInfo => codeInfo.id)).toContain('0');
  });

  it('includes code 0 in generated codebook output', async () => {
    const codebookBuffer = await CodebookGenerator.generateCodebook(
      [
        {
          id: 1,
          key: 'UNIT.VOCS',
          name: 'Unit',
          scheme: JSON.stringify({
            version: '3.0',
            variableCodings: [
              {
                ...variableCoding,
                codes: [
                  {
                    ...manualCode, id: 0, label: 'Code 0', score: 0, type: 'NO_CREDIT'
                  },
                  {
                    ...manualCode, id: 1, label: 'Code 1', score: 1, type: 'FULL_CREDIT'
                  }
                ]
              }
            ]
          })
        }
      ],
      contentSetting as never,
      []
    );

    const codebook = JSON.parse(codebookBuffer.toString('utf-8')) as Array<{
      variables: Array<{ codes: Array<{ id: string }> }>;
    }>;

    expect(codebook[0].variables[0].codes.map(code => code.id)).toEqual(['0', '1']);
  });

  it('filters codes without manual instructions in manual codebooks without closed variables', () => {
    const generator = CodebookGenerator as unknown as Record<string, (...args: unknown[]) => unknown>;

    const codeInfos = generator.getCodes(
      [
        manualCode,
        { ...manualCode, id: 2, manualInstruction: '' },
        { ...manualCode, id: 3, manualInstruction: '   ' },
        { ...manualCode, id: 4, manualInstruction: '<p style="margin-top: 0; min-height: 1em"></p>' }
      ],
      { ...contentSetting, hasOnlyManualCoding: true, hasClosedVars: false }
    ) as { id: string; description: string }[];

    expect(codeInfos).toHaveLength(1);
    expect(codeInfos[0]).toMatchObject({
      id: '1',
      description: '<p>manual</p>'
    });
  });

  it('keeps codes without manual instructions when closed variables are included', () => {
    const generator = CodebookGenerator as unknown as Record<string, (...args: unknown[]) => unknown>;

    const codeInfos = generator.getCodes(
      [
        manualCode,
        { ...manualCode, id: 2, manualInstruction: '' },
        { ...manualCode, id: 3, manualInstruction: '   ' }
      ],
      { ...contentSetting, hasOnlyManualCoding: true, hasClosedVars: true }
    ) as { id: string; description: string }[];

    expect(codeInfos.map(codeInfo => codeInfo.id)).toEqual(['1', '2', '3']);
  });

  it('treats visually empty HTML manual instructions as missing for variable filtering', () => {
    const generator = CodebookGenerator as unknown as Record<string, (...args: unknown[]) => unknown>;
    const whitespaceManualVariable = {
      ...variableCoding,
      codes: [{ ...manualCode, manualInstruction: '<p style="margin-top: 0; min-height: 1em"></p>' }]
    };

    expect(generator.isManual(whitespaceManualVariable)).toBe(false);
    expect(generator.isManualWithoutClosed(whitespaceManualVariable)).toBe(false);
    expect(generator.getManualOrClosedCodedBookVariable(
      { ...contentSetting, hasOnlyManualCoding: true, hasClosedVars: false },
      [],
      whitespaceManualVariable
    )).toBeNull();
  });
});
