import { DataSource, In, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { parseStringPromise } from 'xml2js';
import { extractVariableLocation } from '../utils/voud/extractVariableLocation';
import { generateReplayUrl } from '../utils/replay-url.util';
import { Booklet } from '../database/entities/booklet.entity';
import { BookletInfo } from '../database/entities/bookletInfo.entity';
import { ChunkEntity } from '../database/entities/chunk.entity';
import FileUpload from '../database/entities/file_upload.entity';
import Persons from '../database/entities/persons.entity';
import { ResponseEntity } from '../database/entities/response.entity';
import { Unit } from '../database/entities/unit.entity';
import User from '../database/entities/user.entity';
import WorkspaceUser from '../database/entities/workspace_user.entity';
import { ReplayHealthBrowserRunner } from './replay-health.browser';
import {
  ReplayBrowserCandidate,
  ReplayHealthCheckOptions,
  ReplayHealthCheckReport,
  ReplayHealthCheckResult,
  ReplayPayloadCandidate,
  ReplaySeedRow,
  ReplayUrlCandidate
} from './replay-health.types';
import {
  buildPayloadCandidates,
  normalizePlayerId,
  parseReplayUrl,
  summarizeFailuresByMessage,
  summarizeFailuresByStage
} from './replay-health.utils';

type TimedResult<T> = {
  value: T;
  durationMs: number;
};

export class ReplayHealthRunner {
  private readonly responseRepository: Repository<ResponseEntity>;
  private readonly unitRepository: Repository<Unit>;
  private readonly bookletRepository: Repository<Booklet>;
  private readonly personsRepository: Repository<Persons>;
  private readonly bookletInfoRepository: Repository<BookletInfo>;
  private readonly fileUploadRepository: Repository<FileUpload>;
  private readonly chunkRepository: Repository<ChunkEntity>;
  private readonly userRepository: Repository<User>;
  private readonly workspaceUserRepository: Repository<WorkspaceUser>;

  constructor(private readonly dataSource: DataSource) {
    this.responseRepository = dataSource.getRepository(ResponseEntity);
    this.unitRepository = dataSource.getRepository(Unit);
    this.bookletRepository = dataSource.getRepository(Booklet);
    this.personsRepository = dataSource.getRepository(Persons);
    this.bookletInfoRepository = dataSource.getRepository(BookletInfo);
    this.fileUploadRepository = dataSource.getRepository(FileUpload);
    this.chunkRepository = dataSource.getRepository(ChunkEntity);
    this.userRepository = dataSource.getRepository(User);
    this.workspaceUserRepository = dataSource.getRepository(WorkspaceUser);
  }

  async run(
    options: ReplayHealthCheckOptions
  ): Promise<ReplayHealthCheckReport> {
    const startedAt = new Date();

    const seeds = await this.loadReplaySeeds(options);
    const replayUrls = await this.buildReplayUrls(options.workspaceId, seeds);
    const { payloadCandidates, parseFailures } = buildPayloadCandidates(
      options.workspaceId,
      replayUrls
    );

    const payloadResults: ReplayHealthCheckResult[] = [];
    for (const candidate of payloadCandidates) {
      // Run sequentially to keep DB and file IO pressure predictable.
      // This is intended as a diagnostic task, not a throughput benchmark.
      payloadResults.push(await this.checkPayloadCandidate(candidate));
    }

    const payloadSuccessCount = payloadResults.filter(result => result.ok).length;
    const payloadFailureCount =
      parseFailures.length + payloadResults.filter(result => !result.ok).length;

    const browserCandidates = this.buildBrowserCandidates(
      options.workspaceId,
      replayUrls,
      new Set(
        payloadResults
          .filter(result => result.ok)
          .map(result => `${result.testPerson}::${result.unitId}`)
      )
    );

    let browserResults: ReplayHealthCheckResult[] = [];
    if (options.browser?.enabled && browserCandidates.length > 0) {
      try {
        const authToken = await this.resolveBrowserAuthToken(options);
        const browserRunner = new ReplayHealthBrowserRunner(options.browser);
        browserResults = await browserRunner.run(
          options.workspaceId,
          browserCandidates,
          authToken
        );
      } catch (error) {
        browserResults = [this.browserSetupFailureResult(
          options.workspaceId,
          browserCandidates.length,
          error instanceof Error ? error.message : String(error)
        )];
      }
    }

    const browserSuccessCount = browserResults.filter(result => result.ok).length;
    const browserFailureCount = browserResults.length - browserSuccessCount;
    const results = [...parseFailures, ...payloadResults, ...browserResults];
    const finishedAt = new Date();
    const successCount = payloadSuccessCount + browserSuccessCount;
    const failureCount = payloadFailureCount + browserFailureCount;

    return {
      workspaceId: options.workspaceId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      responseCandidateCount: replayUrls.length,
      payloadCandidateCount: payloadCandidates.length,
      payloadSuccessCount,
      payloadFailureCount,
      browserCandidateCount: browserCandidates.length,
      browserSuccessCount,
      browserFailureCount,
      browserBaseUrl: options.browser?.enabled ? options.browser.baseUrl : undefined,
      browserAuthIdentity: options.browser?.enabled ? options.browser.authIdentity : undefined,
      successCount,
      failureCount,
      failuresByStage: summarizeFailuresByStage(results),
      failuresByMessage: summarizeFailuresByMessage(results),
      results
    };
  }

  private async loadReplaySeeds(
    options: ReplayHealthCheckOptions
  ): Promise<ReplaySeedRow[]> {
    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .select('response.id', 'responseId')
      .addSelect('unit.name', 'unitName')
      .addSelect('unit.alias', 'unitAlias')
      .addSelect('response.variableid', 'variableId')
      .addSelect('bookletinfo.name', 'bookletName')
      .addSelect('person.login', 'personLogin')
      .addSelect('person.code', 'personCode')
      .addSelect('person.group', 'personGroup')
      .where('person.workspace_id = :workspaceId', {
        workspaceId: options.workspaceId
      })
      .andWhere('person.consider = :consider', { consider: true })
      .orderBy('response.id', 'ASC');

    if (options.responseIds && options.responseIds.length > 0) {
      queryBuilder.andWhere('response.id IN (:...responseIds)', {
        responseIds: options.responseIds
      });
    }

    if (options.limit && options.limit > 0) {
      queryBuilder.limit(options.limit);
    }

    const rawRows = await queryBuilder.getRawMany<{
      responseId: number | string;
      unitName: string;
      unitAlias: string | null;
      variableId: string;
      bookletName: string;
      personLogin: string;
      personCode: string;
      personGroup: string | null;
    }>();

    return rawRows.map(row => ({
      responseId: Number(row.responseId),
      unitName: row.unitName,
      unitAlias: row.unitAlias,
      variableId: row.variableId,
      bookletName: row.bookletName,
      personLogin: row.personLogin,
      personCode: row.personCode,
      personGroup: row.personGroup || ''
    }));
  }

  private async buildReplayUrls(
    workspaceId: number,
    seeds: ReplaySeedRow[]
  ): Promise<ReplayUrlCandidate[]> {
    const variablePageMaps = await this.loadVariablePageMaps(
      workspaceId,
      [...new Set(seeds.map(seed => seed.unitName))]
    );

    return seeds.map(seed => {
      const pageMap = variablePageMaps.get(seed.unitName) || new Map<string, string>();
      const variablePage = pageMap.get(seed.variableId) || '0';

      return {
        ...seed,
        replayUrl: generateReplayUrl({
          serverUrl: 'http://localhost',
          loginName: seed.personLogin,
          loginCode: seed.personCode,
          loginGroup: seed.personGroup || '',
          bookletId: seed.bookletName,
          unitId: seed.unitName,
          variablePage,
          variableAnchor: seed.variableId,
          authToken: ''
        }).replace('?auth=', '')
      };
    });
  }

  private async loadVariablePageMaps(
    workspaceId: number,
    unitNames: string[]
  ): Promise<Map<string, Map<string, string>>> {
    const mapByUnit = new Map<string, Map<string, string>>();

    if (unitNames.length === 0) {
      return mapByUnit;
    }

    const voudFiles = await this.fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_type: 'Resource',
        file_id: In(unitNames.map(unitName => `${unitName}.VOUD`))
      }
    });

    const voudFileMap = new Map<string, FileUpload>(
      voudFiles.map(file => [file.file_id, file])
    );

    unitNames.forEach(unitName => {
      const file = voudFileMap.get(`${unitName}.VOUD`);
      const variablePageMap = new Map<string, string>();

      if (file) {
        try {
          const variableLocations = extractVariableLocation([
            { definition: file.data as string }
          ]);

          if (variableLocations[0]?.variable_pages) {
            variableLocations[0].variable_pages.forEach(pageInfo => {
              variablePageMap.set(
                pageInfo.variable_ref,
                pageInfo.variable_path?.pages?.toString() || '0'
              );
            });
          }
        } catch {
          // Keep empty map if the VOUD file cannot be parsed.
        }
      }

      mapByUnit.set(unitName, variablePageMap);
    });

    return mapByUnit;
  }

  private async checkPayloadCandidate(
    candidate: ReplayPayloadCandidate
  ): Promise<ReplayHealthCheckResult> {
    const normalizedUnitId = candidate.unitId.toUpperCase();
    const timingsMs: Record<string, number> = {};

    try {
      const unitDef = await this.time(
        'findUnitDefMs',
        timingsMs,
        () => this.findUnitDef(candidate.workspaceId, normalizedUnitId)
      );
      if (unitDef.length === 0) {
        return this.failureResult(
          candidate,
          'findUnitDef',
          `Unit definition not found for ${candidate.unitId}`,
          timingsMs
        );
      }

      const unitFiles = await this.time(
        'findUnitMs',
        timingsMs,
        () => this.findUnitFile(candidate.workspaceId, normalizedUnitId)
      );
      if (unitFiles.length === 0) {
        return this.failureResult(
          candidate,
          'findUnit',
          `Unit file not found for ${candidate.unitId}`,
          timingsMs
        );
      }

      try {
        await this.time(
          'findUnitResponseMs',
          timingsMs,
          () => this.findUnitResponse(candidate.workspaceId, candidate.testPerson, candidate.unitId)
        );
      } catch (error) {
        return this.failureResult(
          candidate,
          'findUnitResponse',
          error instanceof Error ? error.message : String(error),
          timingsMs
        );
      }

      const playerName = await this.time(
        'extractPlayerIdMs',
        timingsMs,
        () => this.extractNormalizedPlayerIdFromUnit(unitFiles[0])
      );

      let playerFiles: FileUpload[];
      try {
        playerFiles = await this.time(
          'findPlayerMs',
          timingsMs,
          () => this.findPlayer(candidate.workspaceId, playerName)
        );
      } catch (error) {
        return this.failureResult(
          candidate,
          'findPlayer',
          error instanceof Error ? error.message : String(error),
          timingsMs
        );
      }

      if (playerFiles.length === 0) {
        return this.failureResult(
          candidate,
          'findPlayer',
          `Player not found for ${playerName}`,
          timingsMs
        );
      }

      return {
        ok: true,
        phase: 'payload',
        stage: 'findPlayer',
        workspaceId: candidate.workspaceId,
        testPerson: candidate.testPerson,
        unitId: candidate.unitId,
        replayUrl: candidate.replayUrl,
        responseIds: candidate.responseIds,
        occurrenceCount: candidate.occurrenceCount,
        page: candidate.pages[0],
        anchors: candidate.anchors,
        timingsMs
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failureResult(
        candidate,
        'extractPlayerId',
        message,
        timingsMs
      );
    }
  }

  private async findUnitDef(
    workspaceId: number,
    unitId: string
  ): Promise<FileUpload[]> {
    return this.fileUploadRepository.find({
      select: ['file_id', 'filename', 'data', 'workspace_id'],
      where: {
        file_id: `${unitId}.VOUD`,
        workspace_id: workspaceId
      }
    });
  }

  private async findUnitFile(
    workspaceId: number,
    unitId: string
  ): Promise<FileUpload[]> {
    return this.fileUploadRepository.find({
      where: {
        file_id: unitId,
        workspace_id: workspaceId
      }
    });
  }

  private async findUnitResponse(
    workspaceId: number,
    connector: string,
    unitId: string
  ): Promise<{ responseCount: number }> {
    const parts = connector.split('@');
    const login = parts[0];
    const code = parts[1];
    const group = parts.length >= 4 ? parts[2] : undefined;
    const bookletId = parts[parts.length - 1];

    const queryBuilder = this.unitRepository
      .createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .select('unit.id', 'unitId')
      .where('person.login = :login', { login })
      .andWhere('person.code = :code', { code })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('bookletinfo.name = :bookletId', { bookletId })
      .andWhere('unit.alias = :unitId', { unitId });

    if (group) {
      queryBuilder.andWhere('person.group = :group', { group });
    }

    const unitRow = await queryBuilder.getRawOne<{ unitId: number }>();
    const unitDbId = unitRow?.unitId;

    if (!unitDbId) {
      const personWhere: {
        code: string;
        login: string;
        workspace_id: number;
        consider: boolean;
        group?: string;
      } = {
        code,
        login,
        workspace_id: workspaceId,
        consider: true
      };

      if (group) {
        personWhere.group = group;
      }

      const person = await this.personsRepository.findOne({
        where: personWhere
      });

      if (!person) {
        const searchDescription = group ?
          `Person mit Login ${login}, Code ${code} und Gruppe ${group}` :
          `Person mit Login ${login} und Code ${code}`;
        throw new Error(`${searchDescription} wurde nicht gefunden.`);
      }

      const bookletInfo = await this.bookletInfoRepository.findOne({
        where: { name: bookletId }
      });

      if (!bookletInfo) {
        throw new Error(`Kein Booklet mit der ID ${bookletId} gefunden.`);
      }

      const booklet = await this.bookletRepository.findOne({
        where: {
          personid: person.id,
          infoid: bookletInfo.id
        }
      });

      if (!booklet) {
        throw new Error(
          `Kein Booklet für die Person mit ID ${person.id} und Booklet ID ${bookletId} gefunden.`
        );
      }

      throw new Error(
        `Keine Unit mit der ID ${unitId} für das Booklet ${bookletId} gefunden.`
      );
    }

    await this.chunkRepository.find({
      where: { unitid: unitDbId }
    });

    const responseCount = await this.responseRepository.count({
      where: { unitid: unitDbId }
    });

    return { responseCount };
  }

  private async extractNormalizedPlayerIdFromUnit(
    unitFile: FileUpload
  ): Promise<string> {
    const parsed = await parseStringPromise(unitFile.data);
    const playerRef = parsed?.Unit?.DefinitionRef?.[0]?.$?.player;

    if (!playerRef || typeof playerRef !== 'string') {
      throw new Error('Invalid unit file: player definition missing');
    }

    return normalizePlayerId(playerRef);
  }

  private async findPlayer(
    workspaceId: number,
    playerName: string
  ): Promise<FileUpload[]> {
    if (!workspaceId || typeof workspaceId !== 'number') {
      throw new Error('Invalid workspaceId parameter');
    }

    if (!playerName || typeof playerName !== 'string') {
      throw new Error('Invalid playerName parameter');
    }

    const playerNameUpperCase = playerName.toUpperCase();
    const regex = /^(.+?)-(\d+)\.(\d+)(?:\.(\d+))?$/;
    const matches = playerNameUpperCase.match(regex);

    if (matches) {
      const module = matches[1];
      const majorVersion = matches[2];
      const minorVersion = matches[3];

      const exactMinorPlayers = await this.fileUploadRepository
        .createQueryBuilder('file')
        .where('file.workspace_id = :workspaceId', { workspaceId })
        .andWhere(
          '(file.file_id LIKE :patternWithPatch OR file.file_id = :exactTwoPart)',
          {
            patternWithPatch: `${module}-${majorVersion}.${minorVersion}.%`,
            exactTwoPart: `${module}-${majorVersion}.${minorVersion}`
          }
        )
        .getMany();

      if (exactMinorPlayers.length > 0) {
        exactMinorPlayers.sort((left, right) => {
          const partsLeft = left.file_id.split('.');
          const partsRight = right.file_id.split('.');
          const patchLeft =
            partsLeft.length >= 3 ? parseInt(partsLeft[2], 10) : 0;
          const patchRight =
            partsRight.length >= 3 ? parseInt(partsRight[2], 10) : 0;
          return patchRight - patchLeft;
        });

        return [exactMinorPlayers[0]];
      }

      const similarPlayers = await this.fileUploadRepository
        .createQueryBuilder('file')
        .where('file.workspace_id = :workspaceId', { workspaceId })
        .andWhere('file.file_id LIKE :pattern', {
          pattern: `${module}-${majorVersion}.%`
        })
        .getMany();

      if (similarPlayers.length > 0) {
        similarPlayers.sort((left, right) => {
          const partsLeft = left.file_id.split('.');
          const partsRight = right.file_id.split('.');
          const minorLeft =
            partsLeft.length >= 2 ? parseInt(partsLeft[1], 10) : 0;
          const minorRight =
            partsRight.length >= 2 ? parseInt(partsRight[1], 10) : 0;
          const patchLeft =
            partsLeft.length >= 3 ? parseInt(partsLeft[2], 10) : 0;
          const patchRight =
            partsRight.length >= 3 ? parseInt(partsRight[2], 10) : 0;

          if (minorRight !== minorLeft) {
            return minorRight - minorLeft;
          }

          return patchRight - patchLeft;
        });

        return [similarPlayers[0]];
      }
    }

    return this.fileUploadRepository.find({
      where: {
        file_id: playerNameUpperCase,
        workspace_id: workspaceId
      }
    });
  }

  private failureResult(
    candidate: ReplayPayloadCandidate,
    stage: ReplayHealthCheckResult['stage'],
    message: string,
    timingsMs: Record<string, number>
  ): ReplayHealthCheckResult {
    return {
      ok: false,
      phase: 'payload',
      stage,
      workspaceId: candidate.workspaceId,
      testPerson: candidate.testPerson,
      unitId: candidate.unitId,
      replayUrl: candidate.replayUrl,
      responseIds: candidate.responseIds,
      occurrenceCount: candidate.occurrenceCount,
      page: candidate.pages[0],
      anchors: candidate.anchors,
      message,
      timingsMs
    };
  }

  private buildBrowserCandidates(
    workspaceId: number,
    replayUrls: ReplayUrlCandidate[],
    successfulPayloadKeys: Set<string>
  ): ReplayBrowserCandidate[] {
    return replayUrls.flatMap(candidate => {
      const parsed = parseReplayUrl(candidate.replayUrl);
      if (!parsed) {
        return [];
      }

      const key = `${parsed.testPerson}::${parsed.unitId}`;
      if (!successfulPayloadKeys.has(key)) {
        return [];
      }

      return [{
        workspaceId,
        responseId: candidate.responseId,
        testPerson: parsed.testPerson,
        unitId: parsed.unitId,
        page: parsed.page,
        anchor: parsed.anchor,
        replayUrl: candidate.replayUrl
      }];
    });
  }

  private async resolveBrowserAuthToken(
    options: ReplayHealthCheckOptions
  ): Promise<string> {
    if (!options.browser?.enabled) {
      throw new Error('Browser mode is not enabled.');
    }

    if (options.browser.authToken) {
      return options.browser.authToken;
    }

    return this.createBrowserAuthToken(
      options.browser.authIdentity,
      options.workspaceId,
      options.browser.authTokenDays
    );
  }

  private async createBrowserAuthToken(
    identity: string | undefined,
    workspaceId: number,
    durationDays: number
  ): Promise<string> {
    if (!identity) {
      throw new Error('Missing --authIdentity or --authToken for browser mode.');
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('Missing JWT_SECRET environment variable for browser mode.');
    }

    const user = await this.userRepository.findOne({
      where: { identity }
    });

    if (!user) {
      throw new Error(`No user found for identity "${identity}".`);
    }

    if (!user.isAdmin) {
      const workspaceAccess = await this.workspaceUserRepository.findOne({
        where: {
          userId: user.id,
          workspaceId
        }
      });

      if (!workspaceAccess) {
        throw new Error(
          `User "${user.username}" does not have access to workspace ${workspaceId}.`
        );
      }
    }

    const jwtService = new JwtService({
      secret: jwtSecret
    });

    return jwtService.sign(
      {
        userId: user.id,
        username: user.username,
        sub: user.id,
        workspace: workspaceId
      },
      { expiresIn: `${durationDays}d` }
    );
  }

  private browserSetupFailureResult(
    workspaceId: number,
    occurrenceCount: number,
    message: string
  ): ReplayHealthCheckResult {
    return {
      ok: false,
      phase: 'browser',
      stage: 'createAuthToken',
      workspaceId,
      testPerson: '',
      unitId: '',
      replayUrl: '',
      responseIds: [],
      occurrenceCount,
      anchors: [],
      message
    };
  }

  private async time<T>(
    key: string,
    timingsMs: Record<string, number>,
    fn: () => Promise<T>
  ): Promise<T> {
    const result = await this.measure(fn);
    timingsMs[key] = result.durationMs;
    return result.value;
  }

  private async measure<T>(fn: () => Promise<T>): Promise<TimedResult<T>> {
    const startedAt = performance.now();
    const value = await fn();

    return {
      value,
      durationMs: Number((performance.now() - startedAt).toFixed(2))
    };
  }
}
