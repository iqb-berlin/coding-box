import { BadRequestException } from '@nestjs/common';
import { CodebookGenerator as SharedCodebookGenerator, CodebookGenerationError } from '@iqb/ngx-coding-components/codebook-generator';
import type { UnitPropertiesForCodebook as SharedUnit } from '@iqb/ngx-coding-components/codebook-models';
import { CodeBookContentSetting, Missing, UnitPropertiesForCodebook } from './codebook.interfaces';

/** Host adapter for imported metadata; shared filters and rendering belong to the library. */
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
      const codings: { id: string; alias?: string }[] = Array.isArray(scheme?.variableCodings) ? scheme.variableCodings : [];
      if (codings.some((variable: { id?: unknown }) => !variable || typeof variable.id !== 'string')) {
        throw new BadRequestException(`Ungültiges Kodierschema für Aufgabe ${unit.key}.`);
      }
      const items = (unit.metadata?.items || []).flatMap(item => {
        const id = item.id ?? item.key;
        if (id === undefined || id === null) return [];
        // Studio stores source IDs. Resolve those before considering aliases or legacy columns.
        const explicitVariable = codings.find(variable => variable.id === item.variableId) ??
          codings.find(variable => (variable.alias || variable.id) === item.variableId);
        const itemVariables = explicitVariable ? [explicitVariable] : codings.filter(variable => {
          const variableId = variable.alias || variable.id;
          return item[variableId] !== undefined || item[variableId.replace(/\./g, '_')] !== undefined;
        });
        return itemVariables.map(variable => ({ id: String(id), variableId: variable.alias || variable.id }));
      });
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
