import { Component, OnInit, inject } from '@angular/core';
import { NgFor } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatSelect, MatOption, MatSelectChange } from '@angular/material/select';
import { CoderListComponent } from '../coder-list/coder-list.component';
import { CodingJobsComponent } from '../coding-jobs/coding-jobs.component';
import { VariableBundleManagerComponent } from '../variable-bundle-manager/variable-bundle-manager.component';
import { CoderService } from '../../services/coder.service';
import { Coder } from '../../models/coder.model';

@Component({
  selector: 'coding-box-coding-management-manual',
  templateUrl: './coding-management-manual.component.html',
  styleUrls: ['./coding-management-manual.component.scss'],
  imports: [
    NgFor,
    TranslateModule,
    CoderListComponent,
    MatAnchor,
    CodingJobsComponent,
    MatIcon,
    MatButton,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption,
    VariableBundleManagerComponent
  ]
})
export class CodingManagementManualComponent implements OnInit {
  private coderService = inject(CoderService);

  coders: Coder[] = [];
  selectedCoder: Coder | null = null;

  ngOnInit(): void {
    this.loadCoders();
  }

  loadCoders(): void {
    this.coderService.getCoders().subscribe({
      next: coders => {
        this.coders = coders;
      },
      error: error => {
        console.error('Error loading coders:', error);
      }
    });
  }

  onCoderSelected(event: MatSelectChange): void {
    const coderId = event.value;
    this.selectedCoder = this.coders.find(coder => coder.id === coderId) || null;
  }
}
