// eslint-disable-next-line import/no-extraneous-dependencies
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  Footer,
  WidthType,
  PageNumber,
  ITableCellBorders,
  Header, FileChild
} from 'docx';
import * as cheerio from 'cheerio';
// eslint-disable-next-line import/no-extraneous-dependencies
import {
  BookVariable, CodeBookContentSetting, CodebookUnitDto, ItemMetadata
} from './codebook.interfaces';

/**
 * Class for generating DOCX files for codebooks
 */
export class CodebookDocxGenerator {
  /**
   * Generate a DOCX file for a codebook
   * @param codingBookUnits List of codebook units
   * @param contentSetting Codebook content settings
   * @returns Buffer with DOCX file
   */
  static async generateDocx(
    codingBookUnits: CodebookUnitDto[],
    contentSetting: CodeBookContentSetting
  ): Promise<Buffer> {
    if (codingBookUnits.length) {
      const units: FileChild[] = [];
      let missings: Paragraph[] = [];
      codingBookUnits.forEach(variableCoding => {
        missings = this.getMissings(variableCoding);
        if (variableCoding.variables.length || !contentSetting.hasOnlyVarsWithCodes) {
          units.push(...(this.createDocXForUnit(
            variableCoding.items || [],
            variableCoding.variables,
            contentSetting,
            this.getUnitHeader(variableCoding)
          ) as FileChild[]));
        }
      });
      const b64string = await Packer.toBase64String(
        this.setDocXDocument(
          units,
          missings)
      );
      return Buffer.from(b64string, 'base64');
    }
    return Buffer.from('', 'utf-8');
  }

  /**
   * Get unit header
   * @param variableCoding Codebook unit
   * @returns Paragraph with unit header
   */
  private static getUnitHeader(variableCoding: CodebookUnitDto): Paragraph {
    return new Paragraph({
      border: {
        bottom: {
          color: '#000000',
          style: 'single',
          size: 10
        },
        top: {
          color: '#000000',
          style: 'single',
          size: 10
        }
      },
      spacing: {
        after: 200
      },
      text: `${variableCoding.key}  ${variableCoding.name}`,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER
    });
  }

  /**
   * Get missings paragraphs
   * @param variableCoding Codebook unit
   * @returns List of paragraphs with missings
   */
  private static getMissings(variableCoding: CodebookUnitDto): Paragraph[] {
    const missings: Paragraph[] = [];
    try {
      variableCoding.missings.forEach(missing => {
        if (missing.code && missing.label && missing.description) {
          missings.push(new Paragraph({
            children: [new TextRun({ text: `${missing.code} ${missing.label}`, bold: true })],
            spacing: {
              after: 20
            }
          }));
          missings.push(new Paragraph({
            text: `${missing.description}`,
            spacing: {
              after: 100
            }
          }));
        } else {
          missings.push(new Paragraph({
            text: 'kein valides Missing ',
            spacing: {
              after: 200
            }
          }));
        }
      });
    } catch {
      missings.push(new Paragraph({
        text: 'kein validen Missings gefunden',
        spacing: {
          after: 200
        }
      }));
    }
    return missings;
  }

  /**
   * Get table borders
   * @returns Table cell borders
   */
  private static get TableBoarders(): ITableCellBorders {
    return {
      top: {
        size: 1,
        color: '#000000',
        style: 'single'
      },
      bottom: {
        size: 1,
        color: '#000000',
        style: 'single'
      },
      left: {
        size: 1,
        color: '#000000',
        style: 'single'
      },
      right: {
        size: 1,
        color: '#000000',
        style: 'single'
      }
    };
  }

  /**
   * Get code rows for a table
   * @param variable Book variable
   * @param contentSetting Codebook content settings
   * @returns List of table rows
   */
  private static getCodeRows(variable: BookVariable, contentSetting: CodeBookContentSetting): TableRow[] {
    const rows: TableRow[] = [];
    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        new TableCell({
          borders: this.TableBoarders,
          width: {
            size: this.getColumnWidths(contentSetting)[0],
            type: WidthType.DXA
          },
          children: [new Paragraph({
            children: [
              new TextRun({
                text: 'Code',
                bold: true
              })
            ]
          })]
        }),
        new TableCell({
          borders: this.TableBoarders,
          width: {
            size: this.getColumnWidths(contentSetting)[1],
            type: WidthType.DXA
          },
          children: [new Paragraph({
            children: [
              new TextRun({
                text: 'Label',
                bold: true
              })
            ]
          })]
        }),
        new TableCell({
          borders: this.TableBoarders,
          width: {
            size: this.getColumnWidths(contentSetting)[2],
            type: WidthType.DXA
          },
          children: [new Paragraph({
            children: [
              new TextRun({
                text: 'Beschreibung',
                bold: true
              })
            ]
          })]
        })
      ]
    });
    rows.push(headerRow);
    if (contentSetting.showScore) {
      headerRow.addChildElement(
        new TableCell({
          borders: this.TableBoarders,
          width: {
            size: this.getColumnWidths(contentSetting)[3],
            type: WidthType.DXA
          },
          children: [new Paragraph({
            children: [
              new TextRun({
                text: 'Score',
                bold: true
              })
            ]
          })]
        })
      );
    }
    variable.codes.forEach(code => {
      const row = new TableRow({
        children: [
          new TableCell({
            borders: this.TableBoarders,
            width: {
              size: this.getColumnWidths(contentSetting)[0],
              type: WidthType.DXA
            },
            children: [new Paragraph(code.id)]
          }),
          new TableCell({
            borders: this.TableBoarders,
            width: {
              size: this.getColumnWidths(contentSetting)[1],
              type: WidthType.DXA
            },
            children: [new Paragraph(code.label)]
          }),
          new TableCell({
            borders: this.TableBoarders,
            width: {
              size: this.getColumnWidths(contentSetting)[2],
              type: WidthType.DXA
            },
            children: this.htmlToDocx(code.description, contentSetting)
          })
        ]
      });
      if (contentSetting.showScore) {
        row.addChildElement(
          new TableCell({
            borders: this.TableBoarders,
            width: {
              size: this.getColumnWidths(contentSetting)[3],
              type: WidthType.DXA
            },
            children: [new Paragraph(code.score || '')]
          })
        );
      }
      rows.push(row);
    });
    return rows;
  }

  /**
   * Get column widths for a table
   * @param contentSetting Codebook content settings
   * @returns List of column widths
   */
  private static getColumnWidths(contentSetting: CodeBookContentSetting): number[] {
    return contentSetting.showScore ? [1000, 2000, 5000, 1000] : [1000, 2000, 6000];
  }

  /**
   * Get variables for a unit
   * @param codeBookVariable List of book variables
   * @param contentSetting Codebook content settings
   * @param varItems List of item metadata
   * @returns List of file children
   */
  private static getVariables(
    codeBookVariable: BookVariable[],
    contentSetting: CodeBookContentSetting,
    varItems: ItemMetadata[]
  ): FileChild[] {
    const children: FileChild[] = [];
    codeBookVariable.forEach(variable => {
      children.push(this.getVariableHeader(variable));
      if (!contentSetting.hideItemVarRelation) {
        children.push(...this.getVariableItems(variable, varItems));
      }
      if (variable.generalInstruction) {
        children.push(...this.getGeneralInstruction(contentSetting, variable));
      }
      if (variable.codes.length) {
        children.push(this.getCodeTable(variable, contentSetting));
      }
    });
    return children;
  }

  /**
   * Get variable header
   * @param variable Book variable
   * @returns Paragraph with variable header
   */
  private static getVariableHeader(variable: BookVariable): Paragraph {
    return new Paragraph({
      text: `${variable.id} ${variable.label}`,
      heading: HeadingLevel.HEADING_2,
      spacing: {
        before: 400,
        after: 200
      }
    });
  }

  /**
   * Get variable items
   * @param variable Book variable
   * @param varItems List of item metadata
   * @returns List of paragraphs with variable items
   */
  private static getVariableItems(variable: BookVariable, varItems: ItemMetadata[]): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    const items = varItems.filter(item => {
      const variableId = variable.id.replace(/\./g, '_');
      return item[variableId] !== undefined;
    });
    if (items.length) {
      paragraphs.push(new Paragraph({
        text: 'Items:',
        spacing: {
          after: 100
        }
      }));
      items.forEach(item => {
        paragraphs.push(new Paragraph({
          text: `${item.key} ${item.label}`,
          bullet: {
            level: 0
          }
        }));
      });
    }
    return paragraphs;
  }

  /**
   * Get general instruction
   * @param contentSetting Codebook content settings
   * @param codeBookVariable Book variable
   * @returns List of paragraphs with general instruction
   */
  private static getGeneralInstruction(
    contentSetting: CodeBookContentSetting,
    codeBookVariable: BookVariable
  ): Paragraph[] {
    return codeBookVariable.generalInstruction ?
      this.htmlToDocx(codeBookVariable.generalInstruction, contentSetting) : [];
  }

  /**
   * Get code table
   * @param codeBookVariable Book variable
   * @param contentSetting Codebook content settings
   * @returns Table with codes
   */
  private static getCodeTable(codeBookVariable: BookVariable, contentSetting: CodeBookContentSetting): Table {
    return new Table({
      rows: this.getCodeRows(codeBookVariable, contentSetting),
      width: {
        size: 9000,
        type: WidthType.DXA
      }
    });
  }

  /**
   * Create DOCX for a unit
   * @param items List of item metadata
   * @param codeBookVariable List of book variables
   * @param contentSetting Codebook content settings
   * @param unitHeader Paragraph with unit header
   * @returns List of file children
   */
  private static createDocXForUnit(
    items: ItemMetadata[],
    codeBookVariable: BookVariable[],
    contentSetting: CodeBookContentSetting,
    unitHeader: Paragraph
  ): FileChild[] {
    return [
      unitHeader,
      ...this.getVariables(codeBookVariable, contentSetting, items)
    ];
  }

  /**
   * Set DOCX document
   * @param children List of file children
   * @param missings List of paragraphs with missings
   * @returns Document
   */
  private static setDocXDocument(children: FileChild[], missings: Paragraph[]): Document {
    const doc = new Document({
      creator: 'IQB-Kodierbox',
      title: 'Codebook',
      description: 'Codebook',
      styles: {
        paragraphStyles: [
          {
            id: 'Normal',
            name: 'Normal',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: {
              size: 24,
              font: 'Calibri'
            },
            paragraph: {
              spacing: {
                after: 120
              }
            }
          }
        ]
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1000,
                right: 1000,
                bottom: 1000,
                left: 1000
              }
            }
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun('IQB-Studio Codebook '),
                    new TextRun({
                      children: [PageNumber.CURRENT],
                      font: 'Calibri'
                    }),
                    new TextRun({
                      children: [' / '],
                      font: 'Calibri'
                    }),
                    new TextRun({
                      children: [PageNumber.TOTAL_PAGES],
                      font: 'Calibri'
                    })
                  ]
                })
              ]
            })
          },

          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: new Date().toLocaleDateString(),
                      font: 'Calibri'
                    })
                  ]
                })
              ]
            })
          },
          children: [
            new Paragraph({
              text: 'Missings',
              heading: HeadingLevel.HEADING_1,
              spacing: {
                after: 200
              }
            }),
            ...missings,
            ...children
          ]
        }
      ]
    });
    return doc;
  }

  /**
   * Convert HTML to DOCX
   * @param html HTML string
   * @param contentSetting Codebook content settings
   * @returns List of paragraphs
   */
  private static htmlToDocx(html: string, contentSetting: CodeBookContentSetting): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    if (!html) return paragraphs;

    try {
      const $ = cheerio.load(`<div>${html}</div>`);
      const rootElement = $('div')[0];

      if (rootElement && rootElement.children) {
        this.processChildNodes(rootElement.children, paragraphs);
      }
    } catch (error) {
      paragraphs.push(new Paragraph({ text: html }));
    }

    return paragraphs;
  }

  /**
   * Process child nodes
   * @param nodes List of nodes
   * @param paragraphs List of paragraphs
   */
  private static processChildNodes(nodes: any, paragraphs: Paragraph[]): void {
    for (const node of nodes) {
      if (node.type === 'text') {
        if (node.data && node.data.trim()) {
          paragraphs.push(new Paragraph({ text: node.data.trim() }));
        }
      } else if (node.type === 'tag') {
        const element = node as any;
        const tagName = element.name.toLowerCase();

        if (tagName === 'p') {
          const textRuns: TextRun[] = [];
          this.processInlineElements(element.children, textRuns);
          if (textRuns.length > 0) {
            paragraphs.push(new Paragraph({ children: textRuns }));
          }
        } else if (tagName === 'ul' || tagName === 'ol') {
          this.processListElements(element.children, paragraphs, tagName === 'ol');
        } else if (element.children && element.children.length > 0) {
          this.processChildNodes(element.children, paragraphs);
        }
      }
    }
  }

  /**
   * Process inline elements
   * @param nodes List of nodes
   * @param textRuns List of text runs
   */
  private static processInlineElements(nodes: any, textRuns: TextRun[]): void {
    for (const node of nodes) {
      if (node.type === 'text') {
        if (node.data && node.data.trim()) {
          textRuns.push(new TextRun({ text: node.data.trim() }));
        }
      } else if (node.type === 'tag') {
        const element = node as any;
        const tagName = element.name.toLowerCase();

        if (tagName === 'strong' || tagName === 'b') {
          if (element.children) {
            for (const child of element.children) {
              if (child.type === 'text' && child.data) {
                textRuns.push(new TextRun({ text: child.data.trim(), bold: true }));
              }
            }
          }
        } else if (tagName === 'em' || tagName === 'i') {
          if (element.children) {
            for (const child of element.children) {
              if (child.type === 'text' && child.data) {
                textRuns.push(new TextRun({ text: child.data.trim(), italics: true }));
              }
            }
          }
        } else if (element.children && element.children.length > 0) {
          this.processInlineElements(element.children, textRuns);
        }
      }
    }
  }

  /**
   * Process list elements
   * @param nodes List of nodes
   * @param paragraphs List of paragraphs
   * @param isOrdered Whether the list is ordered
   */
  private static processListElements(nodes: any, paragraphs: Paragraph[], isOrdered: boolean): void {
    let index = 1;
    for (const node of nodes) {
      if (node.type === 'tag') {
        const element = node as any;
        if (element.name.toLowerCase() === 'li') {
          const textRuns: TextRun[] = [];
          this.processInlineElements(element.children, textRuns);
          if (textRuns.length > 0) {
            paragraphs.push(new Paragraph({
              children: textRuns,
              bullet: {
                level: 0
              },
              numbering: isOrdered ? {
                reference: 'default-numbering',
                level: 0,
                instance: index++
              } : undefined
            }));
          }
        }
      }
    }
  }
}
