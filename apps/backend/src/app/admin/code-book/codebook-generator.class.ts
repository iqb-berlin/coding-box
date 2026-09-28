import { BadRequestException } from '@nestjs/common';
import { CodebookGenerator as SharedCodebookGenerator, CodebookGenerationError } from '@iqb/ngx-coding-components/codebook-generator';
import type { UnitPropertiesForCodebook as SharedUnit } from '@iqb/ngx-coding-components/codebook-models';
import { CodeBookContentSetting, Missing, UnitPropertiesForCodebook } from './codebook.interfaces';

/** Host adapter: training scope and imported metadata, never rendering/filter semantics. */
export class CodebookGenerator {
  static async generateCodebook(units: UnitPropertiesForCodebook[], options: CodeBookContentSetting, missings: Missing[]): Promise<Buffer> {
    const normalized: SharedUnit[] = units.map(unit => {
      let scheme;
      try { scheme = unit.scheme ? JSON.parse(unit.scheme) : null; } catch {
        throw new BadRequestException(`Ungültiges Kodierschema für Aufgabe ${unit.key}.`);
      }
      if (scheme && !Array.isArray(scheme.variableCodings)) {
        throw new BadRequestException(`Ungültiges Kodierschema für Aufgabe ${unit.key}.`);
      }
      const codings = Array.isArray(scheme?.variableCodings) ? scheme.variableCodings : [];
      if (codings.some((variable: { id?: unknown }) => !variable || typeof variable.id !== 'string')) {
        throw new BadRequestException(`Ungültiges Kodierschema für Aufgabe ${unit.key}.`);
      }
      const items = (unit.metadata?.items || []).flatMap(item => {
        const id = item.id ?? item.key;
        if (id === undefined || id === null) return [];
        return codings.filter((variable: { id: string; alias?: string }) => {
          const variableId = variable.alias || variable.id;
          return item.variableId === variable.id || item.variableId === variableId ||
            item[variableId] !== undefined || item[variableId.replace(/\./g, '_')] !== undefined;
        }).map((variable: { id: string; alias?: string }) => ({ id: String(id), variableId: variable.alias || variable.id }));
      });
      if (scheme && options.trainingRequirement && options.trainingRequirement !== 'all') {
        scheme.variableCodings = codings.filter((variable: { processing?: string[] }) => {
          const required = variable.processing?.includes('CODER_TRAINING_REQUIRED') ?? false;
          return options.trainingRequirement === 'required' ? required : !required;
        });
      }
      return {
        ...unit,
        key: unit.key.replace(/\.vocs$/i, ''),
        scheme: scheme ? JSON.stringify(scheme) : unit.scheme,
        metadata: { items }
      };
    });
    try {
      const blob = await SharedCodebookGenerator.generateCodebook(normalized, options, missings);
      return Buffer.from(await blob.arrayBuffer());
    } catch (error) {
      if (error instanceof CodebookGenerationError) throw new BadRequestException(error.message);
      throw error;
    }
  }
}
