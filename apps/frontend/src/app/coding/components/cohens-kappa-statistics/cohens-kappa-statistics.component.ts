import {
  Component, OnInit, Inject, Optional, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';

interface KappaStatistics {
  unitName: string;
  variableId: string;
  coderPairs: Array<{
    coder1Id: number;
    coder1Name: string;
    coder2Id: number;
    coder2Name: string;
    kappa: number | null;
    agreement: number;
    totalItems: number;
    validPairs: number;
    interpretation: string;
  }>;
}

@Component({
  selector: 'coding-box-cohens-kappa-statistics',
  templateUrl: './cohens-kappa-statistics.component.html',
  styleUrls: ['./cohens-kappa-statistics.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatTooltipModule,
    MatSlideToggleModule,
    FormsModule,
    TranslateModule
  ]
})
export class CohensKappaStatisticsComponent implements OnInit {
  private testPersonCodingService = inject(TestPersonCodingService);
  private appService: AppService = inject(AppService);
  private translateService = inject(TranslateService);

  constructor(
    @Optional() public dialogRef: MatDialogRef<CohensKappaStatisticsComponent>,
    @Optional() @Inject(MAT_DIALOG_DATA) public dialogData: unknown
  ) { }

  isLoading = false;
  kappaStatistics: KappaStatistics[] = [];
  showInterpretationScale = false;
  useWeightedMean = true; // Default to weighted mean (matching R reference implementation)
  excludeTrainings = true; // Default: exclude trainings

  workspaceKappaSummary: {
    coderPairs: Array<{
      coder1Id: number;
      coder1Name: string;
      coder2Id: number;
      coder2Name: string;
      kappa: number | null;
      agreement: number;
      totalSharedResponses: number;
      validPairs: number;
      interpretation: string;
    }>;
    workspaceSummary: {
      totalDoubleCodedResponses: number;
      totalCoderPairs: number;
      averageKappa: number | null;
      variablesIncluded: number;
      codersIncluded: number;
      weightingMethod: 'weighted' | 'unweighted';
    };
  } | null = null;

  ngOnInit(): void {
    this.loadWorkspaceKappaSummary();
    this.loadKappaStatistics();
  }

  private loadWorkspaceKappaSummary(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.testPersonCodingService.getWorkspaceCohensKappaSummary(workspaceId, this.useWeightedMean, this.excludeTrainings)
      .pipe()
      .subscribe({
        next: summary => {
          this.workspaceKappaSummary = summary;
        },
        error: () => {
          this.workspaceKappaSummary = null;
        }
      });
  }

  private loadKappaStatistics(): void {
    this.isLoading = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.isLoading = false;
      return;
    }

    this.testPersonCodingService.getCohensKappaStatistics(workspaceId, this.useWeightedMean, this.excludeTrainings).subscribe({
      next: response => {
        this.kappaStatistics = response.variables;
        this.isLoading = false;
      },
      error: () => {
        this.kappaStatistics = [];
        this.isLoading = false;
      }
    });
  }

  toggleWeightingMethod(): void {
    this.loadWorkspaceKappaSummary();
    this.loadKappaStatistics();
  }

  toggleExcludeTrainings(): void {
    this.loadWorkspaceKappaSummary();
    this.loadKappaStatistics();
  }

  getKappaClass(kappa: number | null): string {
    if (kappa === null) return 'kappa-na';
    if (kappa < 0) return 'kappa-poor';
    if (kappa < 0.2) return 'kappa-poor';
    if (kappa < 0.4) return 'kappa-fair';
    if (kappa < 0.6) return 'kappa-moderate';
    if (kappa < 0.8) return 'kappa-substantial';
    return 'kappa-perfect';
  }

  getKappaInterpretationText(kappa: number | null): string {
    if (kappa === null) {
      return 'Keine Daten verfügbar';
    }
    if (kappa < 0) {
      return 'Schlechte Übereinstimmung (weniger als zufällig)';
    }
    if (kappa < 0.2) {
      return 'Schwache Übereinstimmung';
    }
    if (kappa < 0.4) {
      return 'Mäßige Übereinstimmung';
    }
    if (kappa < 0.6) {
      return 'Akzeptable Übereinstimmung';
    }
    if (kappa < 0.8) {
      return 'Gute Übereinstimmung';
    }
    return 'Ausgezeichnete Übereinstimmung';
  }

  getKappaInterpretationClass(kappa: number | null): string {
    if (kappa === null) {
      return 'kappa-no-data';
    }
    if (kappa < 0) {
      return 'kappa-poor';
    }
    if (kappa < 0.2) {
      return 'kappa-poor';
    }
    if (kappa < 0.4) {
      return 'kappa-fair';
    }
    if (kappa < 0.6) {
      return 'kappa-moderate';
    }
    if (kappa < 0.8) {
      return 'kappa-good';
    }
    return 'kappa-excellent';
  }

  toggleInterpretationScale(): void {
    this.showInterpretationScale = !this.showInterpretationScale;
  }

  getTranslatedInterpretation(interpretationKey: string): string {
    if (!interpretationKey) return '';
    return this.translateService.instant(interpretationKey);
  }
}
