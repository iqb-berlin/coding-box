import {
  BadGatewayException, BadRequestException, ForbiddenException, Injectable, ServiceUnavailableException
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Like, Repository } from 'typeorm';
import { Setting } from '../database/entities/setting.entity';
import {
  normalizeTestcenterBaseUrl, parseAllowedTestcenterUrls, resolveTestcenterBaseUrl, standardTestcenterUrls
} from '../database/services/test-results/testcenter-target';
import {
  TestcenterConnectionTestDto, TestcenterInstanceDto, TestcenterInstanceInput
} from '../../../../../api-dto/testcenter/testcenter-instance.dto';

const settingPrefix = 'system-testcenter-instance-';

@Injectable()
export class TestcenterInstancesService {
  constructor(
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
    private readonly config: ConfigService,
    private readonly http: HttpService
  ) {}

  async getInstances(): Promise<TestcenterInstanceDto[]> {
    const instances = new Map<string, TestcenterInstanceDto>();
    standardTestcenterUrls.forEach((baseUrl, index) => instances.set(baseUrl, {
      label: index ? `Testcenter ${index}` : 'IQB Testcenter', baseUrl, source: 'standard'
    }));
    parseAllowedTestcenterUrls(this.config.get<string>('TESTCENTER_ALLOWED_URLS')).forEach(baseUrl => {
      if (!instances.has(baseUrl)) instances.set(baseUrl, { label: baseUrl, baseUrl, source: 'environment' });
    });
    const stored = await this.settings.find({ where: { key: Like(`${settingPrefix}%`) } });
    for (const setting of stored) {
      const input = this.readStoredInstance(setting);
      if (!instances.has(input.baseUrl)) instances.set(input.baseUrl, { ...input, source: 'administrator' });
    }
    return [...instances.values()];
  }

  async saveInstance(input: TestcenterInstanceInput): Promise<TestcenterInstanceDto[]> {
    const instance = this.validateInput(input);
    const existing = await this.getInstances();
    const same = existing.find(entry => entry.baseUrl === instance.baseUrl);
    if (same && same.source !== 'administrator') {
      throw new BadRequestException('This Testcenter instance is managed by the operator');
    }
    if (!same && existing.filter(entry => entry.source === 'administrator').length >= 100) {
      throw new BadRequestException('At most 100 additional Testcenter instances are allowed');
    }
    await this.settings.save({ key: this.settingKey(instance.baseUrl), content: JSON.stringify(instance) });
    return this.getInstances();
  }

  async deleteInstance(baseUrl: string): Promise<TestcenterInstanceDto[]> {
    const normalized = normalizeTestcenterBaseUrl(baseUrl);
    const existing = (await this.getInstances()).find(entry => entry.baseUrl === normalized);
    if (existing && existing.source !== 'administrator') {
      throw new BadRequestException('This Testcenter instance is managed by the operator');
    }
    await this.settings.delete(this.settingKey(normalized));
    return this.getInstances();
  }

  async resolve(server: string, url = ''): Promise<string> {
    try {
      return resolveTestcenterBaseUrl(server, url, this.config.get<string>('TESTCENTER_ALLOWED_URLS'));
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      const baseUrl = normalizeTestcenterBaseUrl(url);
      // A primary-key lookup keeps per-file authorization independent of the size of the settings table.
      const stored = await this.settings.findOne({ where: { key: this.settingKey(baseUrl) } });
      if (!stored) throw error;
      this.readStoredInstance(stored);
      return baseUrl;
    }
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
        throw new BadGatewayException('Invalid Testcenter version response');
      }
      return { version, checkedAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new ServiceUnavailableException('Testcenter connection failed. Check the address, network and certificate trust.', { cause: error });
    }
  }

  private validateInput(input: TestcenterInstanceInput): TestcenterInstanceInput {
    if (!input || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80 ||
        typeof input.baseUrl !== 'string' || input.baseUrl.length > 2048) {
      throw new BadRequestException('A Testcenter name (up to 80 characters) and base URL are required');
    }
    const baseUrl = normalizeTestcenterBaseUrl(input.baseUrl.trim());
    if (new URL(baseUrl).protocol !== 'https:') {
      throw new BadRequestException('Use HTTPS. HTTP installations require operator configuration in TESTCENTER_ALLOWED_URLS.');
    }
    return { label: input.label.trim(), baseUrl };
  }

  private settingKey(baseUrl: string): string {
    return `${settingPrefix}${createHash('sha256').update(baseUrl).digest('hex')}`;
  }

  private readStoredInstance(setting: Setting): TestcenterInstanceInput {
    try {
      const input = this.validateInput(JSON.parse(setting.content));
      if (setting.key !== this.settingKey(input.baseUrl)) throw new Error();
      return input;
    } catch {
      throw new ServiceUnavailableException('Testcenter instance configuration is invalid');
    }
  }
}
