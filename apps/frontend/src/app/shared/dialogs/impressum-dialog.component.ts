import {
  MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose
} from '@angular/material/dialog';
import { Component } from '@angular/core';
import { MatButton } from '@angular/material/button';

@Component({
  template: `
    <h1 mat-dialog-title>IQB-Studio - Impressum/Datenschutz</h1>
    <mat-dialog-content>
      <p>
        Das Institut zur Qualitätsentwicklung im Bildungswesen betreibt auf diesen Seiten eine Anwendung für das Erstellen von Seiten und Aufgaben für das computerbasierte Leistungstesten von Schülerinnen und Schülern. Die Arbeit mit diesem System erfordert einen persönlichen Account. Der hierzu erforderlichen Speicherung und Verwendung von Daten stimmen die Beteiligten in einem gesonderten Vorgang zu. Zugriffe ohne Account werden weder protokolliert noch in irgendeiner Art gepeichert.
      </p>
      <h2>Postanschrift:</h2>
      <p>
        Humboldt-Universität zu Berlin<br>
        Institut zur Qualitätsentwicklung im Bildungswesen<br>
        Unter den Linden 6<br>
        10099 Berlin
      </p>
      <h2>Sitz:</h2>
      <p>
        Luisenstr. 56<br>
        10117 Berlin<br>
        Tel: +49 [30] 2093 - 46500 (Zentrale)<br>
        Fax: +49 [30] 2093 - 46599<br>
        E-Mail: iqboffice&#64;iqb.hu-berlin.de
      </p>
      <h2>Name und Anschrift der Datenschutzbeauftragten</h2>
      <p>
        Frau Gesine Hoffmann-Holland<br>
        Unter den Linden 6<br>
        10099 Berlin<br>
        Tel: +49 (30) 2093-20020<br>
        E-Mail: datenschutz&#64;uv.hu-berlin.de<br>
        www.hu-berlin.de/de/datenschutz
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-raised-button color="primary" [mat-dialog-close]="true">Schließen</button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-content {
      max-height: 70vh;
      padding: 20px;
      line-height: 1.5;
    }
    h1 {
      color: #07465e;
      font-size: 20px;
      margin-bottom: 15px;
    }
    h2 {
      color: #07465e;
      font-size: 16px;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    p {
      margin-bottom: 15px;
    }
  `],
  standalone: true,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatButton, MatDialogClose]
})
export class ImpressumDialogComponent {}
