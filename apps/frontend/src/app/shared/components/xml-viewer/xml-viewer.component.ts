import { Clipboard } from '@angular/cdk/clipboard';
import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';

type XmlFormatResult = {
  content: string;
  hasParseError: boolean;
};

@Component({
  selector: 'coding-box-xml-viewer',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    TranslateModule
  ],
  templateUrl: './xml-viewer.component.html',
  styleUrls: ['./xml-viewer.component.scss']
})
export class XmlViewerComponent implements OnChanges {
  @Input() xml: string | null | undefined = '';

  formattedXml = '';
  hasParseError = false;
  lineWrap = false;
  copySucceeded = false;

  private readonly indentUnit = '  ';
  private rawXml = '';

  constructor(private clipboard: Clipboard) {}

  ngOnChanges(): void {
    this.rawXml = this.xml ?? '';

    const result = this.formatXml(this.rawXml);

    this.formattedXml = result.content;
    this.hasParseError = result.hasParseError;
  }

  toggleLineWrap(): void {
    this.lineWrap = !this.lineWrap;
  }

  copyToClipboard(): void {
    this.copySucceeded = this.clipboard.copy(this.rawXml);

    if (this.copySucceeded) {
      window.setTimeout(() => {
        this.copySucceeded = false;
      }, 1500);
    }
  }

  private formatXml(xml: string): XmlFormatResult {
    const trimmedXml = xml.trim();

    if (!trimmedXml) {
      return { content: '', hasParseError: false };
    }

    const document = new DOMParser().parseFromString(trimmedXml, 'application/xml');

    if (document.getElementsByTagName('parsererror').length > 0 || !document.documentElement) {
      return { content: xml, hasParseError: true };
    }

    return {
      content: this.formatTokens(this.tokenizeXml(trimmedXml)).join('\n'),
      hasParseError: false
    };
  }

  private tokenizeXml(xml: string): string[] {
    const tokens: string[] = [];
    let currentIndex = 0;

    while (currentIndex < xml.length) {
      const tagStartIndex = xml.indexOf('<', currentIndex);

      if (tagStartIndex === -1) {
        tokens.push(xml.slice(currentIndex));
        break;
      }

      if (tagStartIndex > currentIndex) {
        tokens.push(xml.slice(currentIndex, tagStartIndex));
      }

      const tagEndIndex = this.findTagEndIndex(xml, tagStartIndex);

      tokens.push(xml.slice(tagStartIndex, tagEndIndex));
      currentIndex = tagEndIndex;
    }

    return tokens;
  }

  private findTagEndIndex(xml: string, tagStartIndex: number): number {
    if (xml.startsWith('<!--', tagStartIndex)) {
      return this.findSequenceEndIndex(xml, tagStartIndex, '-->');
    }

    if (xml.startsWith('<![CDATA[', tagStartIndex)) {
      return this.findSequenceEndIndex(xml, tagStartIndex, ']]>');
    }

    if (xml.startsWith('<?', tagStartIndex)) {
      return this.findSequenceEndIndex(xml, tagStartIndex, '?>');
    }

    return this.findQuotedTagEndIndex(xml, tagStartIndex);
  }

  private findSequenceEndIndex(xml: string, tagStartIndex: number, sequence: string): number {
    const sequenceStartIndex = xml.indexOf(sequence, tagStartIndex);

    return sequenceStartIndex === -1 ?
      xml.length :
      sequenceStartIndex + sequence.length;
  }

  private findQuotedTagEndIndex(xml: string, tagStartIndex: number): number {
    let quote: string | null = null;
    let doctypeSubsetDepth = 0;
    const isDoctype = /^<!DOCTYPE/i.test(xml.slice(tagStartIndex, tagStartIndex + 9));

    for (let index = tagStartIndex + 1; index < xml.length; index++) {
      const character = xml[index];

      if (quote) {
        if (character === quote) {
          quote = null;
        }

        continue;
      }

      if (character === '"' || character === '\'') {
        quote = character;
        continue;
      }

      if (isDoctype && character === '[') {
        doctypeSubsetDepth += 1;
        continue;
      }

      if (isDoctype && character === ']') {
        doctypeSubsetDepth = Math.max(doctypeSubsetDepth - 1, 0);
        continue;
      }

      if (character === '>' && doctypeSubsetDepth === 0) {
        return index + 1;
      }
    }

    return xml.length;
  }

  private formatTokens(tokens: string[]): string[] {
    const lines: string[] = [];
    let depth = 0;
    let appendClosingTag = false;

    tokens.forEach((token, index) => {
      if (!token.startsWith('<')) {
        if (!token.trim()) {
          return;
        }

        if (this.shouldInlineText(tokens, index)) {
          lines[lines.length - 1] += token;
          appendClosingTag = true;
          return;
        }

        token
          .split(/\r?\n/)
          .filter(line => line.trim())
          .forEach(line => lines.push(`${this.indentUnit.repeat(depth)}${line}`));
        return;
      }

      if (this.isClosingTag(token)) {
        depth = Math.max(depth - 1, 0);

        if (appendClosingTag) {
          lines[lines.length - 1] += token;
          appendClosingTag = false;
          return;
        }

        lines.push(`${this.indentUnit.repeat(depth)}${token}`);
        return;
      }

      lines.push(`${this.indentUnit.repeat(depth)}${token}`);

      if (!this.isStandaloneTag(token)) {
        depth += 1;
      }
    });

    return lines;
  }

  private shouldInlineText(tokens: string[], index: number): boolean {
    return !tokens[index].includes('\n') &&
      index > 0 &&
      index < tokens.length - 1 &&
      this.isOpeningTag(tokens[index - 1]) &&
      this.isClosingTag(tokens[index + 1]);
  }

  private isOpeningTag(token: string): boolean {
    return token.startsWith('<') &&
      !this.isClosingTag(token) &&
      !this.isStandaloneTag(token);
  }

  private isClosingTag(token: string): boolean {
    return /^<\//.test(token);
  }

  private isStandaloneTag(token: string): boolean {
    return /\/\s*>$/.test(token) ||
      /^<\?/.test(token) ||
      /^<!--/.test(token) ||
      /^<!\[CDATA\[/.test(token) ||
      /^<!DOCTYPE/i.test(token);
  }
}
