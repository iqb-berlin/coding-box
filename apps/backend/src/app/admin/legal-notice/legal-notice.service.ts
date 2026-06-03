import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LegalNoticeDto, UpdateLegalNoticeDto } from '../../../../../../api-dto/legal-notice/legal-notice.dto';
import { defaultLegalNoticeHtml } from '../../../../../../api-dto/legal-notice/default-legal-notice-html';
import { Setting } from '../../database/entities/setting.entity';

@Injectable()
export class LegalNoticeService {
  private readonly settingKey = 'system-legal-notice-html';

  private readonly maxHtmlLength = 50000;

  constructor(
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>
  ) {}

  async getLegalNotice(): Promise<LegalNoticeDto> {
    const setting = await this.settingRepository.findOne({
      where: { key: this.settingKey }
    });

    return {
      html: setting?.content || defaultLegalNoticeHtml,
      isDefault: !setting
    };
  }

  async updateLegalNotice(input: UpdateLegalNoticeDto | null | undefined): Promise<LegalNoticeDto> {
    const html = (input?.html || '').trim();
    if (!html) {
      throw new BadRequestException('Impressum/Datenschutz-Text darf nicht leer sein.');
    }
    if (html.length > this.maxHtmlLength) {
      throw new BadRequestException(
        `Impressum/Datenschutz-Text darf maximal ${this.maxHtmlLength} Zeichen lang sein.`
      );
    }

    const existing = await this.settingRepository.findOne({
      where: { key: this.settingKey }
    });

    if (existing) {
      existing.content = html;
      await this.settingRepository.save(existing);
    } else {
      await this.settingRepository.save(
        this.settingRepository.create({
          key: this.settingKey,
          content: html
        })
      );
    }

    return {
      html,
      isDefault: false
    };
  }

  async resetLegalNotice(): Promise<LegalNoticeDto> {
    await this.settingRepository.delete({ key: this.settingKey });
    return {
      html: defaultLegalNoticeHtml,
      isDefault: true
    };
  }
}
