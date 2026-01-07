import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import * as libxmljs from 'libxmljs2';
import { In, Repository } from 'typeorm';
import { FileUpload } from '../../common';

@Injectable()
export class WorkspaceXmlSchemaValidationService {
  private readonly logger = new Logger(
    WorkspaceXmlSchemaValidationService.name
  );

  private readonly xsdCache = new Map<
  string,
  { xsdDoc: libxmljs.Document; fetchedAt: number }
  >();

  private readonly XSD_CACHE_TTL_MS = 60 * 60 * 1000;

  constructor(
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>
  ) {}

  async validateAllXmlSchemas(
    workspaceId: number
  ): Promise<Map<string, { schemaValid: boolean; errors: string[] }>> {
    const results = new Map<
    string,
    { schemaValid: boolean; errors: string[] }
    >();

    const BATCH_SIZE = 200;
    let offset = 0;

    let xmlFiles = await this.fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_type: In(['Unit', 'Booklet', 'TestTakers', 'Testtakers'])
      },
      select: ['file_id', 'filename', 'file_type', 'data'],
      skip: offset,
      take: BATCH_SIZE
    });

    while (xmlFiles.length > 0) {
      for (const file of xmlFiles) {
        const fileId = (file.file_id || file.filename || '').toUpperCase();
        const key = `${file.file_type}:${fileId}`;

        const xml = file.data;
        try {
          const validation = await this.validateXmlViaXsdUrl(xml);
          results.set(key, validation);

          if (validation.schemaValid) {
            this.logger.debug(`XSD validation ok: ${key}`);
          } else {
            const maxErrors = 10;
            const errorsPreview = (validation.errors || []).slice(0, maxErrors);
            this.logger.warn(
              `XSD validation failed: ${key} (errors: ${
                validation.errors.length
              }) ${JSON.stringify(errorsPreview)}`
            );
          }
        } catch (e) {
          const message =
            e instanceof Error ?
              e.message :
              'Unknown XML schema validation error';
          results.set(key, { schemaValid: false, errors: [message] });
          this.logger.error(
            `XSD validation error: ${key}: ${message}`,
            e instanceof Error ? e.stack : undefined
          );
        }
      }

      offset += BATCH_SIZE;
      xmlFiles = await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_type: In(['Unit', 'Booklet', 'TestTakers', 'Testtakers'])
        },
        select: ['file_id', 'filename', 'file_type', 'data'],
        skip: offset,
        take: BATCH_SIZE
      });
    }

    return results;
  }

  async validateXmlViaXsdUrl(
    xml: string
  ): Promise<{ schemaValid: boolean; errors: string[] }> {
    const xsdUrl = this.normalizeXsdUrl(this.extractXsdUrlFromXml(xml));
    const xsdDoc = await this.getXsdDocCached(xsdUrl);
    return this.validateXmlAgainstSchemaDoc(xml, xsdDoc);
  }

  private normalizeXsdUrl(xsdUrl: string): string {
    let url: URL;
    try {
      url = new URL(xsdUrl);
    } catch {
      return xsdUrl;
    }

    if (url.hostname !== 'github.com') {
      return xsdUrl;
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 5) {
      return xsdUrl;
    }

    const [org, repo, blobLiteral, branch, ...rest] = parts;
    if (blobLiteral !== 'blob' || rest.length === 0) {
      return xsdUrl;
    }

    return `https://raw.githubusercontent.com/${org}/${repo}/${branch}/${rest.join(
      '/'
    )}`;
  }

  private extractXsdUrlFromXml(xml: string): string {
    const xmlDoc = libxmljs.parseXml(xml);
    const root = xmlDoc.root();
    if (!root) {
      throw new Error('Invalid XML: no root element');
    }

    const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
    const attrs = root.attrs() || [];

    const findXsiAttrValue = (
      localName: 'noNamespaceSchemaLocation' | 'schemaLocation'
    ): string | null => {
      for (const attr of attrs) {
        const ns =
          attr.namespace && typeof attr.namespace === 'function' ?
            attr.namespace() :
            null;
        const nsHref = ns && typeof ns.href === 'function' ? ns.href() : null;
        const attrName = (
          typeof attr.name === 'function' ? attr.name() : ''
        ).trim();

        const localMatches =
          attrName === localName || attrName.endsWith(`:${localName}`);
        const nsMatches = nsHref === XSI_NS;

        if (localMatches && (nsMatches || attrName.includes(':'))) {
          const v = (
            typeof attr.value === 'function' ? attr.value() : ''
          ).trim();
          return v || null;
        }
      }
      return null;
    };

    const noNsValue = findXsiAttrValue('noNamespaceSchemaLocation');
    if (noNsValue) {
      return noNsValue;
    }

    const schemaLocValue = findXsiAttrValue('schemaLocation');
    if (schemaLocValue) {
      const tokens = schemaLocValue.split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        return tokens[tokens.length - 1];
      }
    }

    const relevantAttrs = attrs
      .map(a => {
        const n = typeof a.name === 'function' ? a.name() : '';
        const v = typeof a.value === 'function' ? a.value() : '';
        return { name: n, value: v };
      })
      .filter(a => a.name.includes('schema') || a.name.includes('xsi'));
    throw new Error(
      `No XSD URL found in XML (xsi:noNamespaceSchemaLocation / xsi:schemaLocation). root=${root.name()} attrs=${JSON.stringify(
        relevantAttrs
      )}`
    );
  }

  private async getXsdDocCached(xsdUrl: string): Promise<libxmljs.Document> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(xsdUrl);
    } catch {
      throw new Error(`Invalid XSD URL: ${xsdUrl}`);
    }

    if (parsedUrl.protocol !== 'https:') {
      throw new Error(`Only https XSD URLs are allowed: ${xsdUrl}`);
    }

    const now = Date.now();
    const cached = this.xsdCache.get(xsdUrl);
    if (cached && now - cached.fetchedAt < this.XSD_CACHE_TTL_MS) {
      this.logger.debug(`XSD cache hit: ${xsdUrl}`);
      return cached.xsdDoc;
    }

    this.logger.debug(`XSD cache miss, fetching: ${xsdUrl}`);
    const res = await axios.get<string>(xsdUrl, {
      responseType: 'text',
      timeout: 10000,
      maxContentLength: 2 * 1024 * 1024
    });

    const xsdText = (res.data ?? '').toString();
    const xsdDoc = libxmljs.parseXml(xsdText);
    this.xsdCache.set(xsdUrl, { xsdDoc, fetchedAt: now });
    return xsdDoc;
  }

  private validateXmlAgainstSchemaDoc(
    xml: string,
    xsdDoc: libxmljs.Document
  ): { schemaValid: boolean; errors: string[] } {
    try {
      const xmlDoc = libxmljs.parseXml(xml);
      const isValid = xmlDoc.validate(xsdDoc);
      if (isValid) {
        return { schemaValid: true, errors: [] };
      }

      const rawErrors = (xmlDoc.validationErrors || [])
        .map(e => (e && typeof e.message === 'string' ? e.message.trim() : String(e))
        )
        .filter(Boolean);
      const errors =
        rawErrors.length > 0 ? rawErrors : ['XML schema validation failed'];
      return { schemaValid: false, errors };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { schemaValid: false, errors: [message] };
    }
  }
}
