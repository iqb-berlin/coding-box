import {
  ToTextFactory, CodeAsText, CodingScheme, VariableCodingData, CodeData
} from '@iqb/responses';
import {
  BookVariable,
  CodeBookContentSetting,
  CodebookUnitDto,
  CodeInfo,
  Missing,
  UnitPropertiesForCodebook
} from './codebook.interfaces';
import { CodebookDocxGenerator } from './codebook-docx-generator.class';

/**
 * Class for generating codebooks
 */
export class CodebookGenerator {
  static generateCodebook(
    units: UnitPropertiesForCodebook[],
    contentSetting: CodeBookContentSetting,
    missings: Missing[]
  ): Promise<Buffer> {
    if (units.length === 0) {
      return Promise.resolve(Buffer.from('[]', 'utf-8'));
    }
    const codebook: CodebookUnitDto[] = units.map((unit: UnitPropertiesForCodebook) => this.getCodeBookDataForUnit(unit, contentSetting, missings));

    if (contentSetting.exportFormat === 'docx') {
      return CodebookDocxGenerator.generateDocx(codebook, contentSetting);
    }

    return new Promise(resolve => {
      const noItemsCodebook = codebook.map((unit: CodebookUnitDto) => ({
        key: unit.key,
        name: unit.name,
        variables: unit.variables,
        missings: unit.missings
      }));
      const data = JSON.stringify(noItemsCodebook);
      resolve(Buffer.from(data, 'utf-8'));
    });
  }

  private static getCodeBookDataForUnit(
    unit: UnitPropertiesForCodebook,
    contentSetting: CodeBookContentSetting,
    missings: Missing[]
  ): CodebookUnitDto {
    const parsedScheme = unit.scheme ? new CodingScheme(unit.scheme) : null;
    const variableCodings = parsedScheme?.variableCodings || [];
    const bookVariables = this.getBookVariables(variableCodings, contentSetting);
    return {
      key: unit.key,
      name: unit.name,
      variables: this.getSortedBookVariables(bookVariables.filter(v => v.sourceType !== 'BASE_NO_VALUE')),
      missings: missings,
      items: unit.metadata?.items
    };
  }

  private static getBookVariables(
    variableCodings: VariableCodingData[],
    contentSetting: CodeBookContentSetting
  ): BookVariable[] {
    return variableCodings.reduce((bookVariables: BookVariable[], variableCoding) => {
      const bookVariable = this.getBaseOrDerivedBookVariable(variableCoding, contentSetting);
      if (bookVariable) bookVariables.push(bookVariable);
      return bookVariables;
    }, []);
  }

  private static getSortedBookVariables(bookVariables: BookVariable[]): BookVariable[] {
    return bookVariables.sort((a, b) => {
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
  }

  private static getBaseOrDerivedBookVariable(
    variableCoding: VariableCodingData,
    contentSetting: CodeBookContentSetting
  ): BookVariable | null {
    const codes: CodeInfo[] = this.getCodes(variableCoding.codes, contentSetting);
    const isDerived: boolean = (variableCoding.sourceType !== 'BASE' && variableCoding.sourceType !== 'BASE_NO_VALUE');
    if (!isDerived || contentSetting.hasDerivedVars) {
      return this.getManualOrClosedCodedBookVariable(contentSetting, codes, variableCoding);
    }
    return null;
  }

  private static getManualOrClosedCodedBookVariable(
    contentSetting: CodeBookContentSetting,
    codes: CodeInfo[],
    variableCoding: VariableCodingData
  ): BookVariable | null {
    if (contentSetting.hasOnlyVarsWithCodes && codes.length === 0) {
      return null;
    }
    if (contentSetting.hasOnlyManualCoding && !contentSetting.hasClosedVars) {
      if (!this.isManualWithoutClosed(variableCoding)) {
        return null;
      }
    } else if (contentSetting.hasOnlyManualCoding) {
      if (!this.isManual(variableCoding)) {
        return null;
      }
    } else if (!contentSetting.hasClosedVars) {
      if (this.isClosedWithoutManual(variableCoding)) {
        return null;
      }
    }
    return {
      id: variableCoding.alias || variableCoding.id,
      label: variableCoding.label,
      sourceType: variableCoding.sourceType,
      generalInstruction: contentSetting.hasGeneralInstructions ?
        variableCoding.manualInstruction :
        '',
      codes: codes
    };
  }

  private static isClosed(variableCoding: VariableCodingData): boolean {
    return variableCoding.codes.some(codeData => codeData.type === 'RESIDUAL_AUTO' || codeData.type === 'INTENDED_INCOMPLETE');
  }

  private static isManual(variableCoding: VariableCodingData): boolean {
    return variableCoding.codes.some(codeData => codeData.manualInstruction);
  }

  private static isManualWithoutClosed(variableCoding: VariableCodingData): boolean {
    return variableCoding.codes.some(codeData => codeData.manualInstruction &&
      (codeData.type !== 'RESIDUAL_AUTO' && codeData.type !== 'INTENDED_INCOMPLETE'));
  }

  private static isClosedWithoutManual(variableCoding: VariableCodingData): boolean {
    return variableCoding.codes
      .some(codeData => (codeData.type === 'RESIDUAL_AUTO' || codeData.type === 'INTENDED_INCOMPLETE') && !codeData.manualInstruction);
  }

  private static getCodes(codes: CodeData[], contentSetting: CodeBookContentSetting): CodeInfo[] {
    return codes.reduce((codeInfos: CodeInfo[], code) => {
      if (code.id) {
        try {
          const codeInfo = this.getCodeInfoFromCodeAsText(code, contentSetting);
          codeInfos.push(codeInfo);
        } catch (error) {
          const codeInfo = this.getCodeInfo(code, contentSetting);
          codeInfos.push(codeInfo);
        }
      }
      return codeInfos;
    }, []);
  }

  private static getCodeInfo(code: CodeData, contentSetting: CodeBookContentSetting): CodeInfo {
    const codeInfo: CodeInfo = {
      id: `${code.id}`,
      label: '',
      description:
        '<p>Kodierschema mit Schemer Version ab 1.5 erzeugen!</p>'
    };
    if (contentSetting.showScore) codeInfo.score = '';
    return codeInfo;
  }

  private static getCodeInfoFromCodeAsText(code: CodeData, contentSetting: CodeBookContentSetting): CodeInfo {
    const codeAsText = ToTextFactory.codeAsText(code, 'SIMPLE');
    const rulesDescription = contentSetting.hasOnlyManualCoding && !contentSetting.hasClosedVars ? '' :
      this.getRulesDescription(codeAsText, code);
    const codeInfo: CodeInfo = {
      id: `${code.id}`,
      label: contentSetting.codeLabelToUpper ? codeAsText.label.toUpperCase() : codeAsText.label,
      description: `${rulesDescription}${code.manualInstruction}`
    };
    if (contentSetting.showScore) codeInfo.score = codeAsText.score.toString();
    return codeInfo;
  }

  private static getRulesDescription(codeAsText: CodeAsText, code: CodeData): string {
    let rulesDescription = '';
    codeAsText.ruleSetDescriptions.forEach(
      (ruleSetDescription: string) => {
        if (ruleSetDescription !== 'Keine Regeln definiert.') {
          rulesDescription += `<p>${ruleSetDescription}</p>`;
        } else if (code.manualInstruction === '') rulesDescription += `<p>${ruleSetDescription}</p>`;
      }
    );
    return rulesDescription;
  }
}
