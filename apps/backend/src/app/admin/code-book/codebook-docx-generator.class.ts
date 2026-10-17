import { CodebookDocxGenerator as SharedDocxGenerator } from '@iqb/ngx-coding-components/codebook-generator';
import type { CodeBookContentSetting, CodebookUnitDto } from '@iqb/ngx-coding-components/codebook-models';

/** Compatibility adapter for direct callers. */
export class CodebookDocxGenerator {
  static async generateDocx(units: CodebookUnitDto[], options: CodeBookContentSetting): Promise<Buffer> {
    const blob = await SharedDocxGenerator.generateDocx(units, options);
    return Buffer.from(await blob.arrayBuffer());
  }
}
