import { Component, Inject } from '@angular/core';
import {
  MAT_DIALOG_DATA, MatDialogRef, MatDialogTitle, MatDialogContent, MatDialogActions
} from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { XmlViewerComponent } from '../../components/xml-viewer/xml-viewer.component';

export interface DialogData {
  title: string;
  content: string;
  isJson?: boolean;
  isXml?: boolean;
  showDeleteButton?: boolean;
}

@Component({
  selector: 'coding-box-content-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatDivider,
    XmlViewerComponent
  ],
  template: `
    <h2 mat-dialog-title class="dialog-title">{{ data.title }}</h2>
    <mat-dialog-content [class.xml-dialog-content]="data.isXml">
      <div class="content-container" [class.xml-content-container]="data.isXml">
        @if (data.isJson) {
          <pre class="json-content">{{ displayContent }}</pre>
        } @else if (data.isXml) {
          <coding-box-xml-viewer [xml]="data.content"></coding-box-xml-viewer>
        } @else {
          <pre>{{ displayContent }}</pre>
        }
      </div>
    </mat-dialog-content>
    <mat-divider></mat-divider>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Schließen</button>
      @if (data.showDeleteButton) {
        <button mat-button color="warn" (click)="close(true)">Aus Datenbank löschen</button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .dialog-title {
      flex: 0 0 auto;
    }

    mat-divider,
    mat-dialog-actions {
      flex: 0 0 auto;
    }

    mat-dialog-content {
      flex: 1 1 auto;
      min-height: 0;
      max-height: 80vh;
      overflow-y: auto;
    }

    mat-dialog-content.xml-dialog-content {
      display: flex;
      flex-direction: column;
      max-height: calc(90vh - 96px);
      overflow: hidden;
    }

    .content-container {
      padding: 1rem;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      background-color: #f9f9f9;
    }

    .content-container.xml-content-container {
      display: flex;
      flex: 1 1 auto;
      min-height: 0;
      padding: 0;
      overflow: hidden;
      background-color: transparent;
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

    coding-box-xml-viewer {
      flex: 1 1 auto;
      min-height: 0;
      height: 100%;
      width: 100%;
      --xml-viewer-code-max-height: calc(90vh - 160px);
    }
  `]
})
export class ContentDialogComponent {
  readonly displayContent: string;

  constructor(
    public dialogRef: MatDialogRef<ContentDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DialogData
  ) {
    this.displayContent = data.isJson ? this.formatJson(data.content) : data.content;
  }

  close(deleteFromDb: boolean = false): void {
    this.dialogRef.close(deleteFromDb);
  }

  private formatJson(jsonString: string): string {
    try {
      const obj = JSON.parse(jsonString);
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return jsonString;
    }
  }
}
