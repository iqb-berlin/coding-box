import AdmZip = require('adm-zip');
import {
  CodeBookContentSetting,
  CodebookUnitDto
} from './codebook.interfaces';
import { CodebookDocxGenerator } from './codebook-docx-generator.class';

jest.setTimeout(30000);

const defaultSettings: CodeBookContentSetting = {
  exportFormat: 'docx',
  missingsProfile: '',
  hasOnlyManualCoding: false,
  hasGeneralInstructions: false,
  hasDerivedVars: false,
  hasOnlyVarsWithCodes: false,
  hasClosedVars: false,
  codeLabelToUpper: false,
  showScore: false,
  hideItemVarRelation: true
};

const buildUnits = (description: string): CodebookUnitDto[] => [
  {
    key: 'U1',
    name: 'Unit 1',
    missings: [],
    items: [],
    variables: [
      {
        id: 'V1',
        label: 'Variable 1',
        sourceType: 'MANUAL',
        generalInstruction: '',
        codes: [
          {
            id: '1',
            label: 'Label 1',
            score: '1',
            description
          }
        ]
      }
    ]
  }
];

const getDocumentXml = async (description: string): Promise<string> => {
  const buffer = await CodebookDocxGenerator.generateDocx(
    buildUnits(description),
    defaultSettings
  );
  const zip = new AdmZip(buffer);
  return zip.readAsText('word/document.xml');
};

describe('CodebookDocxGenerator integration', () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('creates DOCX XML without undefined wrappers for formula spans', async () => {
    const description =
      '<p>Formel: ' +
      '<span class="iqb-math-formula" data-latex="a<b">' +
      '<span><math><semantics><mrow><mi>a</mi><mo>&lt;</mo><mi>b</mi></mrow></semantics></math></span>' +
      '</span>' +
      '</p>';

    const documentXml = await getDocumentXml(description);

    expect(documentXml).not.toContain('<undefined>');
    expect(documentXml).toContain('<m:oMath');
    expect(documentXml).toContain('a&lt;b');
    expect(documentXml).not.toContain('a<b</m:t>');
  });

  it('creates DOCX XML without undefined wrappers for iqb-math tokens', async () => {
    const description = '<p>Formel: [[iqb-math:a%3Cb]]</p>';

    const documentXml = await getDocumentXml(description);

    expect(documentXml).not.toContain('<undefined>');
    expect(documentXml).toContain('<m:oMath');
    expect(documentXml).toContain('a&lt;b');
    expect(documentXml).not.toContain('a<b</m:t>');
  });

  it('exports formula-only paragraphs as left-aligned math paragraphs', async () => {
    const description = '<p><span class="iqb-math-formula" data-latex="e^2=m"></span></p>';

    const documentXml = await getDocumentXml(description);

    expect(documentXml).toContain('<m:oMathPara>');
    expect(documentXml).toContain('<m:oMathParaPr><m:jc m:val="left"/></m:oMathParaPr>');
    expect(documentXml).toContain('<m:oMath');
  });

  it('keeps inline formulas inline when paragraph text is present', async () => {
    const description =
      '<p>Prefix <span class="iqb-math-formula" data-latex="e^2=m"></span> suffix</p>';

    const documentXml = await getDocumentXml(description);

    expect(documentXml).not.toContain('<m:oMathPara>');
    expect(documentXml).toContain('<m:oMath');
    expect(documentXml).toContain('Prefix');
    expect(documentXml).toContain('suffix');
  });
});
