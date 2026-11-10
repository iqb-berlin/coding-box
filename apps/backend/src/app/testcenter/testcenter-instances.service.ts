import {
  BadRequestException, ForbiddenException, HttpStatus, Injectable, ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Like, Repository } from 'typeorm';
import { testcenterConnectionError, TestcenterConnectionException } from './testcenter-connection-error';
import { Setting } from '../database/entities/setting.entity';
import {
  normalizeTestcenterBaseUrl, parseAllowedTestcenterUrls, testcenterBaseUrl, standardTestcenterUrls
} from '../database/services/test-results/testcenter-target';
import {
  TestcenterConnectionTestDto, TestcenterInstanceDto, TestcenterInstanceInput
} from '../../../../../api-dto/testcenter/testcenter-instance.dto';

const settingPrefix = 'system-testcenter-instance-';
const instanceLockNamespace = 774020260;
type StoredInstance = TestcenterInstanceInput & { revoked?: true };

function invalidInput(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

@Injectable()
export class TestcenterInstancesService {
  constructor(
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
    private readonly config: ConfigService,
    private readonly http: HttpService
  ) {}

  async getInstances(): Promise<TestcenterInstanceDto[]> {
    return this.readInstances(this.settings);
  }

  private async readInstances(settings: Repository<Setting>): Promise<TestcenterInstanceDto[]> {
    const instances = new Map<string, TestcenterInstanceDto>();
    standardTestcenterUrls.forEach((baseUrl, index) => instances.set(baseUrl, {
      label: index ? `Testcenter ${index}` : 'IQB Testcenter', baseUrl, source: 'standard'
    }));
    parseAllowedTestcenterUrls(this.config.get<string>('TESTCENTER_ALLOWED_URLS')).forEach(baseUrl => {
      instances.set(baseUrl, { label: baseUrl, baseUrl, source: 'environment' });
    });
    const stored = await settings.find({ where: { key: Like(`${settingPrefix}%`) } });
    for (const setting of stored) {
      const input = this.readStoredInstance(setting);
      if (instances.get(input.baseUrl)?.source === 'environment') continue;
      if (input.revoked) instances.delete(input.baseUrl);
      else instances.set(input.baseUrl, { label: input.label, baseUrl: input.baseUrl, source: standardTestcenterUrls.includes(input.baseUrl) ? 'standard' : 'administrator' });
    }
    return [...instances.values()];
  }

  async saveInstance(input: TestcenterInstanceInput): Promise<TestcenterInstanceDto[]> {
    const instance = this.validateInput(input);
    return this.withMutation(async settings => {
      const existing = await this.readInstances(settings);
      const same = existing.find(entry => entry.baseUrl === instance.baseUrl);
      if (same && same.source === 'environment') {
        throw invalidInput('TESTCENTER_OPERATOR_MANAGED', 'This Testcenter instance is managed by the operator');
      }
      if (!same && !standardTestcenterUrls.includes(instance.baseUrl) && existing.filter(entry => entry.source === 'administrator').length >= 100) {
        throw invalidInput('TESTCENTER_INSTANCE_LIMIT', 'At most 100 additional Testcenter instances are allowed');
      }
      await settings.save({ key: this.settingKey(instance.baseUrl), content: JSON.stringify(instance) });
      return this.readInstances(settings);
    });
  }

  async deleteInstance(baseUrl: string): Promise<TestcenterInstanceDto[]> {
    const normalized = normalizeTestcenterBaseUrl(baseUrl);
    return this.withMutation(async settings => {
      const existing = (await this.readInstances(settings)).find(entry => entry.baseUrl === normalized);
      if (existing && existing.source === 'environment') {
        throw invalidInput('TESTCENTER_OPERATOR_MANAGED', 'This Testcenter instance is managed by the operator');
      }
      if (standardTestcenterUrls.includes(normalized)) {
        // Persist revocation so built-in defaults cannot reappear after restart or on another replica.
        await settings.save({ key: this.settingKey(normalized), content: JSON.stringify({ label: existing?.label || normalized, baseUrl: normalized, revoked: true }) });
      } else await settings.delete(this.settingKey(normalized));
      return this.readInstances(settings);
    });
  }

  private async withMutation<T>(change: (settings: Repository<Setting>) => Promise<T>): Promise<T> {
    // Serialize approval changes across API replicas, including when no settings row exists yet.
    return this.settings.manager.transaction('READ COMMITTED', async manager => {
      await manager.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [instanceLockNamespace, 0]);
      return change(manager.getRepository(Setting));
    });
  }

  async resolve(server: string, url = ''): Promise<string> {
    const baseUrl = testcenterBaseUrl(server, url);
    if (parseAllowedTestcenterUrls(this.config.get<string>('TESTCENTER_ALLOWED_URLS')).includes(baseUrl)) return baseUrl;
    // Standard destinations need the same per-request check as additional approvals.
    const stored = await this.settings.findOne({ where: { key: this.settingKey(baseUrl) } });
    if (stored ? !this.readStoredInstance(stored).revoked : standardTestcenterUrls.includes(baseUrl)) return baseUrl;
    throw new ForbiddenException('Testcenter target is not allowed');
  }

  async testConnection(baseUrl: string): Promise<TestcenterConnectionTestDto> {
    const target = await this.resolve('', baseUrl);
    try {
      const { data } = await this.http.axiosRef.get<unknown>(`${target}/api/version`, {
        timeout: 10_000,
        signal: AbortSignal.timeout(10_000),
        maxRedirects: 0,
        maxContentLength: 4096,
        maxBodyLength: 4096
      });
      const version = data && typeof data === 'object' && 'version' in data ? data.version : undefined;
      if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version) || version.length > 64) {
        throw new TestcenterConnectionException('TESTCENTER_INVALID_VERSION', HttpStatus.BAD_GATEWAY);
      }
      return { version, checkedAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof TestcenterConnectionException) throw error;
      throw testcenterConnectionError(error);
    }
  }

  private validateInput(input: TestcenterInstanceInput): TestcenterInstanceInput {
    if (!input || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80 ||
        typeof input.baseUrl !== 'string' || input.baseUrl.length > 2048) {
      throw invalidInput('TESTCENTER_INVALID_INPUT', 'A Testcenter name (up to 80 characters) and base URL are required');
    }
    let baseUrl: string;
    try { baseUrl = normalizeTestcenterBaseUrl(input.baseUrl.trim()); } catch {
      throw invalidInput('TESTCENTER_INVALID_URL', 'Invalid Testcenter base URL');
    }
    return { label: input.label.trim(), baseUrl };
  }

  private settingKey(baseUrl: string): string {
    return `${settingPrefix}${createHash('sha256').update(baseUrl).digest('hex')}`;
  }

  private readStoredInstance(setting: Setting): StoredInstance {
    try {
      const data = JSON.parse(setting.content);
      const input = this.validateInput(data);
      if (setting.key !== this.settingKey(input.baseUrl)) throw new Error();
      return { ...input, ...(data.revoked === true ? { revoked: true as const } : {}) };
    } catch {
      throw new ServiceUnavailableException('Testcenter instance configuration is invalid');
    }
  }
}
