import {
  BadRequestException, Injectable, Logger, Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, EntityManager } from 'typeorm';
import * as cheerio from 'cheerio';
import { SaveCodingProgressDto } from '../../../admin/coding-job/dto/save-coding-progress.dto';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import FileUpload from '../../entities/file_upload.entity';
import { CodingFileCacheService } from './coding-file-cache.service';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';
import { hasVisibleManualInstruction } from '../../../utils/manual-instruction.util';
import { DEFAULT_CODING_FILE_LOAD_CONCURRENCY, RuntimeConfigService } from '../../../config/runtime-config.service';
import {
  CodingSchemeCode, SelectableReviewCode, CodingSchemeVariableCoding, CodingScheme
} from './coding-job.types';

@Injectable()
export class CodingJobSchemeService {
  private readonly logger = new Logger(CodingJobSchemeService.name);

  constructor(
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    @Optional()
    private readonly codingFileCacheService?: CodingFileCacheService,
    @Optional()
    private readonly replayAnchorService?: CodingReplayAnchorService,
    @Optional()
    private readonly runtimeConfig?: RuntimeConfigService
  ) {}

  async validateProgressSelectedCode(
    progress: SaveCodingProgressDto,
    codingJobUnit: CodingJobUnit,
    workspaceId: number,
    allowComments: boolean
  ): Promise<NonNullable<SaveCodingProgressDto['selectedCode']> | null> {
    if (progress.isOpen === true) {
      return null;
    }

    const selectedCode = progress.selectedCode;
    if (selectedCode === null) {
      return null;
    }

    if (!selectedCode || typeof selectedCode !== 'object') {
      throw new BadRequestException(
        'selectedCode must be an object, null, or omitted only when isOpen is true'
      );
    }

    if (!Number.isInteger(selectedCode.id)) {
      throw new BadRequestException('selectedCode.id must be an integer');
    }

    const allowedIssueCodes = new Set([-1, -2, -3, -4]);
    if (selectedCode.id < 0 && !allowedIssueCodes.has(selectedCode.id)) {
      throw new BadRequestException(
        `Unsupported coding issue code: ${selectedCode.id}`
      );
    }

    if (
      selectedCode.codingIssueOption !== undefined &&
      selectedCode.codingIssueOption !== null &&
      !allowedIssueCodes.has(selectedCode.codingIssueOption)
    ) {
      throw new BadRequestException(
        `Unsupported coding issue option: ${selectedCode.codingIssueOption}`
      );
    }

    const commentBoundIssueCodes = new Set([-1, -2]);
    const codingIssueOption = selectedCode.codingIssueOption ?? null;
    if (
      !allowComments &&
      (commentBoundIssueCodes.has(selectedCode.id) ||
        (codingIssueOption !== null && commentBoundIssueCodes.has(codingIssueOption)))
    ) {
      throw new BadRequestException(
        'Coding issue options requiring comments are disabled for this coding job'
      );
    }

    if (
      selectedCode.id === -1 ||
      (selectedCode.codingIssueOption === -1 && selectedCode.id < 0)
    ) {
      throw new BadRequestException(
        'Code assignment uncertain requires a regular code'
      );
    }

    const newCodeNeededCode = -2;
    const nextNotes = Object.prototype.hasOwnProperty.call(progress, 'notes') ?
      progress.notes :
      codingJobUnit.notes;
    if (
      (selectedCode.id === newCodeNeededCode ||
        selectedCode.codingIssueOption === newCodeNeededCode) &&
      !(nextNotes ?? '').trim()
    ) {
      throw new BadRequestException(
        'New code needed requires coder notes'
      );
    }

    if (selectedCode.id < 0) {
      selectedCode.score = null;
      return selectedCode;
    }

    const schemeCode = await this.getCodingSchemeCodeForUnit(
      codingJobUnit,
      workspaceId,
      selectedCode.id
    );
    if (!this.hasManualInstruction(schemeCode)) {
      throw new BadRequestException(
        `Code is not available for manual coding: ${selectedCode.id}`
      );
    }
    selectedCode.score = schemeCode.score ?? null;

    if (
      selectedCode.score !== undefined &&
      selectedCode.score !== null &&
      !Number.isFinite(selectedCode.score)
    ) {
      throw new BadRequestException(
        'selectedCode.score must be a finite number'
      );
    }

    return selectedCode;
  }

  hasManualInstruction(code: { manualInstruction?: string | null }): boolean {
    return hasVisibleManualInstruction(code);
  }

  async getCodingSchemeScoreForUnitCode(
    codingJobUnit: CodingJobUnit,
    workspaceId: number,
    codeId: number
  ): Promise<number | null> {
    if (!Number.isInteger(codeId) || codeId < 0) {
      throw new BadRequestException(
        `Unsupported coding scheme code: ${codeId}`
      );
    }

    const schemeCode = await this.getCodingSchemeCodeForUnit(
      codingJobUnit,
      workspaceId,
      codeId
    );
    return schemeCode.score ?? null;
  }

  async getSelectableReviewCodeForUnit(
    codingJobUnit: CodingJobUnit,
    workspaceId: number,
    codeId: number,
    manager?: EntityManager
  ): Promise<SelectableReviewCode> {
    if (!Number.isInteger(codeId) || codeId < 0) {
      throw new BadRequestException(
        `Unsupported coding scheme code: ${codeId}`
      );
    }

    const schemeCode = await this.getCodingSchemeCodeForUnit(
      codingJobUnit,
      workspaceId,
      codeId,
      manager
    );
    const selectableCode = this.toSelectableReviewCode(schemeCode);
    if (!selectableCode) {
      throw new BadRequestException(
        `Code is not available for manual review: ${codeId}`
      );
    }
    return selectableCode;
  }

  async getSelectableReviewCodesForUnits(
    codingJobUnits: CodingJobUnit[],
    workspaceId: number
  ): Promise<Map<CodingJobUnit, SelectableReviewCode[]>> {
    const codingSchemesByUnit = await this.getCodingSchemesForUnits(
      codingJobUnits,
      workspaceId
    );
    const result = new Map<CodingJobUnit, SelectableReviewCode[]>();

    codingJobUnits.forEach(unit => {
      const codingScheme = codingSchemesByUnit.get(unit);
      const variableCoding = codingScheme ?
        this.findVariableCoding(codingScheme, unit.variable_id) :
        undefined;
      const codes = (variableCoding?.codes || [])
        .map(code => this.toSelectableReviewCode(code))
        .filter((code): code is SelectableReviewCode => code !== undefined);

      result.set(unit, codes);
    });

    return result;
  }

  toSelectableReviewCode(
    code: CodingSchemeCode
  ): SelectableReviewCode | undefined {
    const codeId = Number(code.id);
    if (!Number.isInteger(codeId) || codeId < 0 || !this.hasManualInstruction(code)) {
      return undefined;
    }
    return {
      code: codeId,
      label: String(code.label || code.code || code.id),
      score: code.score ?? null
    };
  }

  async getCodingSchemeCodeForUnit(
    codingJobUnit: CodingJobUnit,
    workspaceId: number,
    codeId: number,
    manager?: EntityManager
  ): Promise<CodingSchemeCode> {
    const codingScheme = await this.getRequiredCodingSchemeForUnit(
      codingJobUnit,
      workspaceId,
      manager
    );
    const variableCoding = this.findVariableCoding(
      codingScheme,
      codingJobUnit.variable_id
    );
    if (!variableCoding?.codes) {
      throw new BadRequestException(
        `Coding scheme variable not found: ${codingJobUnit.variable_id}`
      );
    }

    const schemeCode = variableCoding.codes.find(
      code => Number(code.id) === codeId
    );
    if (!schemeCode) {
      throw new BadRequestException(
        `Unsupported code for variable ${codingJobUnit.variable_id}: ${codeId}`
      );
    }

    return schemeCode;
  }

  findVariableCoding(
    codingScheme: CodingScheme,
    variableId: string
  ): CodingSchemeVariableCoding | undefined {
    const normalizedVariableId = String(variableId || '').trim();
    if (!normalizedVariableId) {
      return undefined;
    }

    const variableCodings = codingScheme.variableCodings || [];
    return variableCodings.find(
      vc => String(vc.alias || '').trim() === normalizedVariableId
    ) || variableCodings.find(
      vc => String(vc.id || '').trim() === normalizedVariableId
    );
  }

  async getCodingSchemeForUnit(
    codingJobUnit: CodingJobUnit,
    workspaceId: number,
    manager?: EntityManager
  ): Promise<CodingScheme | undefined> {
    const codingSchemesByUnit = await this.getCodingSchemesForUnits(
      [codingJobUnit],
      workspaceId,
      manager
    );
    return codingSchemesByUnit.get(codingJobUnit);
  }

  async getCodingSchemesForUnits(
    codingJobUnits: CodingJobUnit[],
    workspaceId: number,
    manager?: EntityManager
  ): Promise<Map<CodingJobUnit, CodingScheme>> {
    const codingSchemesByUnit = new Map<CodingJobUnit, CodingScheme>();
    const unitFileCandidatesByUnit = new Map<CodingJobUnit, string[]>();
    const unitFileIds = new Set<string>();

    codingJobUnits.forEach(unit => {
      const candidates = this.getUnitFileIdCandidates(unit);
      if (candidates.length > 0) {
        unitFileCandidatesByUnit.set(unit, candidates);
        candidates.forEach(candidate => unitFileIds.add(candidate));
      }
    });

    if (unitFileIds.size === 0) {
      return codingSchemesByUnit;
    }

    const fileUploadRepository = manager?.getRepository(FileUpload) ||
      this.fileUploadRepository;
    const unitFiles = await fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_id: In([...unitFileIds])
      },
      select: ['file_id', 'data']
    });
    const unitFileById = new Map(unitFiles.map(file => [file.file_id, file]));
    const codingSchemeRefsByUnitFileId = new Map<string, string[]>();
    const codingSchemeRefsByUnit = new Map<CodingJobUnit, string[]>();
    const codingSchemeRefs = new Set<string>();

    codingJobUnits.forEach(unit => {
      const unitFile = this.findFileByCandidates(
        unitFileById,
        unitFileCandidatesByUnit.get(unit) ?? []
      );
      if (!unitFile) {
        return;
      }

      let refs = codingSchemeRefsByUnitFileId.get(unitFile.file_id);
      if (!refs) {
        const codingSchemeRef = this.extractCodingSchemeRef(unitFile);
        refs = codingSchemeRef ?
          this.getCodingSchemeFileIdCandidates(codingSchemeRef) :
          [];
        codingSchemeRefsByUnitFileId.set(unitFile.file_id, refs);
      }

      if (refs.length === 0) {
        return;
      }
      codingSchemeRefsByUnit.set(unit, refs);
      refs.forEach(ref => codingSchemeRefs.add(ref));
    });

    if (codingSchemeRefs.size === 0) {
      return codingSchemesByUnit;
    }

    const codingSchemes = await this.getCodingSchemes(
      [...codingSchemeRefs],
      workspaceId,
      manager
    );
    codingSchemeRefsByUnit.forEach((refs, unit) => {
      const scheme = refs
        .map(ref => codingSchemes.get(ref))
        .find(
          (candidate): candidate is CodingScheme => candidate !== undefined
        );
      if (scheme) {
        codingSchemesByUnit.set(unit, scheme);
      }
    });

    return codingSchemesByUnit;
  }

  async getRequiredCodingSchemeForUnit(
    codingJobUnit: CodingJobUnit,
    workspaceId: number,
    manager?: EntityManager
  ): Promise<CodingScheme> {
    const codingScheme = await this.getCodingSchemeForUnit(
      codingJobUnit,
      workspaceId,
      manager
    );
    if (!codingScheme) {
      throw new BadRequestException(
        'Coding scheme not found for coding job unit'
      );
    }

    return codingScheme;
  }

  getUnitFileIdCandidates(codingJobUnit: CodingJobUnit): string[] {
    return this.getFileIdCandidates(
      codingJobUnit.unit_alias,
      codingJobUnit.unit_name,
      '.XML'
    );
  }

  getCodingSchemeFileIdCandidates(codingSchemeRef: string): string[] {
    return this.getFileIdCandidates(codingSchemeRef, null, '.VOCS');
  }

  getFileIdCandidates(
    primaryRef: string | null | undefined,
    fallbackRef: string | null | undefined,
    extension: '.XML' | '.VOCS'
  ): string[] {
    const candidates = new Set<string>();

    [primaryRef, fallbackRef].forEach(ref => {
      const trimmedRef = ref?.trim();
      if (!trimmedRef) {
        return;
      }

      const upperRef = trimmedRef.toUpperCase();
      const withoutExtension = upperRef.endsWith(extension) ?
        upperRef.slice(0, -extension.length) :
        upperRef;
      const basename = withoutExtension.split('/').pop();

      candidates.add(trimmedRef);
      candidates.add(upperRef);
      candidates.add(withoutExtension);
      candidates.add(`${withoutExtension}${extension}`);

      if (basename) {
        candidates.add(basename);
        candidates.add(`${basename}${extension}`);
      }
    });

    return [...candidates];
  }

  findFileByCandidates(
    fileById: Map<string, FileUpload>,
    candidates: string[]
  ): FileUpload | undefined {
    return candidates
      .map(candidate => fileById.get(candidate))
      .find((file): file is FileUpload => file !== undefined);
  }

  extractCodingSchemeRef(unitFile: FileUpload): string | null {
    try {
      const $ = cheerio.load(String(unitFile.data ?? ''));
      return (
        $('codingSchemeRef').first().text().trim() ||
        $('CodingSchemeRef').first().text().trim() ||
        null
      );
    } catch (error) {
      this.logger.warn(
        `Could not parse unit file ${unitFile.file_id}: ${error.message}`
      );
      return null;
    }
  }

  async getVariablePageMapsForUnits(
    units: CodingJobUnit[],
    workspaceId: number
  ): Promise<Map<string, Map<string, string>>> {
    const variablePageMaps = new Map<string, Map<string, string>>();

    if (!this.codingFileCacheService) {
      return variablePageMaps;
    }

    const unitNames = Array.from(
      new Set(
        units
          .map(unit => unit.unit_name)
          .filter(unitName => unitName.length > 0)
      )
    );

    let nextUnitIndex = 0;
    const loadNextUnit = async (): Promise<void> => {
      while (nextUnitIndex < unitNames.length) {
        const unitName = unitNames[nextUnitIndex];
        nextUnitIndex += 1;
        try {
          const pageMap = await this.codingFileCacheService!.getVariablePageMap(
            unitName,
            workspaceId
          );
          variablePageMaps.set(unitName, pageMap);
        } catch (error) {
          this.logger.warn(
            `Error loading variable page map for coding job unit ${unitName}: ${error.message}`
          );
          variablePageMaps.set(unitName, new Map<string, string>());
        }
      }
    };

    await Promise.all(
      Array.from(
        {
          length: Math.min(
            this.runtimeConfig?.codingFileLoadConcurrency ??
              DEFAULT_CODING_FILE_LOAD_CONCURRENCY,
            unitNames.length
          )
        },
        () => loadNextUnit()
      )
    );

    return variablePageMaps;
  }

  async getVariableAnchorMapsForUnits(
    units: CodingJobUnit[],
    workspaceId: number
  ): Promise<Map<string, Map<string, string>>> {
    const variableAnchorMaps = new Map<string, Map<string, string>>();

    if (!this.replayAnchorService) {
      return variableAnchorMaps;
    }

    const unitNames = Array.from(
      new Set(
        units
          .map(unit => unit.unit_name)
          .filter(unitName => unitName.length > 0)
      )
    );

    try {
      return await this.replayAnchorService.getVariableAnchorMaps(
        unitNames,
        workspaceId
      );
    } catch (error) {
      this.logger.warn(
        `Error loading variable anchor maps for coding job units in workspace ${workspaceId}: ${error.message}`
      );
      unitNames.forEach(unitName => {
        variableAnchorMaps.set(unitName, new Map<string, string>());
      });
      return variableAnchorMaps;
    }
  }

  async getCodingSchemes(
    unitAliases: string[],
    workspaceId: number,
    manager?: EntityManager
  ): Promise<Map<string, CodingScheme>> {
    const codingSchemeRefs = unitAliases.filter(alias => alias !== null);
    const codingSchemes = new Map<string, CodingScheme>();

    if (codingSchemeRefs.length === 0) {
      return codingSchemes;
    }

    const repository = manager?.getRepository(FileUpload) ||
      this.fileUploadRepository;
    const codingSchemeFiles = await repository.find({
      where: {
        workspace_id: workspaceId,
        file_id: In(codingSchemeRefs)
      },
      select: ['file_id', 'data']
    });

    for (const file of codingSchemeFiles) {
      try {
        const data =
          typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
        codingSchemes.set(file.file_id, data);
      } catch (error) {
        codingSchemes.set(file.file_id, {});
      }
    }

    return codingSchemes;
  }
}
