import { BadRequestException, Injectable } from '@nestjs/common';
import { PsychometricDomainCandidatesDto } from '../../../../../../../api-dto/coding/psychometric-discrimination.dto';
import { PsychometricAnalysisEngine } from './psychometric-analysis-engine';
import { PsychometricExportWriter } from './psychometric-export-writer.service';
import {
  NormalizedPsychometricExportServiceOptions,
  PsychometricAnalysis,
  PsychometricExportServiceOptions
} from './psychometric-export.types';
import { PsychometricMetadataResolver } from './psychometric-metadata-resolver.service';
import { PsychometricResponseReader } from './psychometric-response-reader.service';

export type { PsychometricExportServiceOptions } from './psychometric-export.types';

@Injectable()
export class CodingPsychometricExportService {
  constructor(
    private readonly metadataResolver: PsychometricMetadataResolver,
    private readonly responseReader: PsychometricResponseReader,
    private readonly analysisEngine: PsychometricAnalysisEngine,
    private readonly exportWriter: PsychometricExportWriter
  ) {}

  async getDomainCandidates(
    workspaceId: number
  ): Promise<PsychometricDomainCandidatesDto> {
    return this.metadataResolver.getDomainCandidates(workspaceId);
  }

  async exportPsychometricsAsCsv(
    options: PsychometricExportServiceOptions
  ): Promise<NodeJS.ReadableStream> {
    return this.exportWriter.createCsvStream(
      checkCancellation => this.analyze({
        ...options,
        checkCancellation
      }),
      options.checkCancellation
    );
  }

  async writePsychometricsExcelToFile(
    filePath: string,
    options: PsychometricExportServiceOptions
  ): Promise<void> {
    const analysis = await this.analyze(options);
    await this.exportWriter.writeExcelToFile(
      filePath,
      analysis,
      options.checkCancellation
    );
  }

  private async analyze(
    rawOptions: PsychometricExportServiceOptions
  ): Promise<PsychometricAnalysis> {
    const options = this.normalizeOptions(rawOptions);
    await options.checkCancellation?.();
    await options.onProgress?.(2);

    const mapping = await this.metadataResolver.buildItemMapping(
      options.workspaceId
    );
    if (mapping.issues.length > 0) {
      const preview = mapping.issues.slice(0, 10).join('; ');
      const suffix =
        mapping.issues.length > 10 ?
          `; weitere Probleme: ${mapping.issues.length - 10}` :
          '';
      throw new BadRequestException(
        `VOMD-Itemzuordnung ist unvollständig oder mehrdeutig: ${preview}${suffix}`
      );
    }
    if (mapping.items.length === 0) {
      throw new BadRequestException(
        'Keine auswertbaren Items mit VOMD-Zuordnung gefunden'
      );
    }

    this.metadataResolver.assignDomains(mapping, options.domain);
    const missingDefinitions =
      await this.metadataResolver.loadMissingDefinitions(
        options.workspaceId,
        options.missingsProfileId
      );

    return this.responseReader.withSnapshot(
      {
        workspaceId: options.workspaceId,
        version: options.version,
        mapping
      },
      snapshot => this.analysisEngine.analyze({
        options,
        mapping,
        missingDefinitions,
        snapshot
      }),
      options.checkCancellation
    );
  }

  private normalizeOptions(
    options: PsychometricExportServiceOptions
  ): NormalizedPsychometricExportServiceOptions {
    const version = options.version || 'v2';
    if (!['v1', 'v2', 'v3'].includes(version)) {
      throw new BadRequestException(
        'Psychometrie-Exporte unterstützen nur v1, v2 oder v3'
      );
    }

    const maxCategoryCount = options.maxCategoryCount ?? 10;
    if (
      !Number.isSafeInteger(maxCategoryCount) ||
      maxCategoryCount < 1 ||
      maxCategoryCount > 100
    ) {
      throw new BadRequestException(
        'maxCategoryCount muss eine ganze Zahl zwischen 1 und 100 sein'
      );
    }
    if (
      options.partWholeCorrection !== undefined &&
      typeof options.partWholeCorrection !== 'boolean'
    ) {
      throw new BadRequestException(
        'partWholeCorrection muss ein boolescher Wert sein'
      );
    }

    return {
      ...options,
      version,
      partWholeCorrection: options.partWholeCorrection !== false,
      domain: options.domain || { mode: 'workspace' },
      maxCategoryCount
    };
  }
}
