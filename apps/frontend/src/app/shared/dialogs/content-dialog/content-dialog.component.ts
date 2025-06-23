import { Component, Inject } from '@angular/core';
import {
  MAT_DIALOG_DATA, MatDialogRef, MatDialogTitle, MatDialogContent, MatDialogActions
} from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';

export interface DialogData {
  title: string;
  content: string;
  isJson?: boolean;
  isXml?: boolean;
}

@Component({
  selector: 'app-content-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatDivider
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <div class="content-container">
        @if (data.isJson) {
          <pre class="json-content">{{ formatJson(data.content) }}</pre>
        } @else if (data.isXml) {
          <pre class="xml-content">{{ formatXml(data.content) }}</pre>
        } @else {
          <pre>{{ data.content }}</pre>
        }
      </div>
    </mat-dialog-content>
    <mat-divider></mat-divider>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Schließen</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .content-container {
      max-height: 80vh;
      overflow-y: auto;
      padding: 1rem;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      background-color: #f9f9f9;
    }

    pre {
      margin: 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    .json-content {
      font-family: 'Consolas', 'Monaco', monospace;
      color: #333;
    }

    .xml-content {
      font-family: 'Consolas', 'Monaco', monospace;
      color: #333;
    }
  `]
})
export class ContentDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<ContentDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DialogData
  ) {}

  close(): void {
    this.dialogRef.close();
  }

  formatJson(jsonString: string): string {
    try {
      const obj = JSON.parse(jsonString);
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return jsonString;
    }
  }

  formatXml(xmlString: string): string {
    return xmlString
      .replace(/></g, '>\n<')
      .replace(/>\s*<\/(\w+)>/g, '>\n</$1>')
      .replace(/<(\w+)([^>]*)\/>/g, '<$1$2/>\n');
  }
}
