import { Component } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule, UntypedFormGroup } from '@angular/forms';
import { NgIf } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { UnitPlayerComponent } from '../unit-player/unit-player.component';
import { BackendService } from '../../services/backend.service';
import { AppService } from '../../services/app.service';

@Component({
  selector: 'upload-results-button',
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, ReactiveFormsModule, NgIf, UnitPlayerComponent, MatIcon],
  templateUrl: './upload-results-button.component.html',
  styleUrl: './upload-results-button.component.scss'
})
export class UploadResultsButtonComponent {
  private uploadSubscription: Subscription | null = null;

  constructor(
              private appService: AppService,
              public backendService: BackendService) {
  }

  onFileSelected(targetElement: EventTarget | null) {
    if (targetElement) {
      const inputElement = targetElement as HTMLInputElement;
      if (inputElement.files && inputElement.files.length > 0) {
        this.appService.dataLoading = true;
        this.uploadSubscription = this.backendService.uploadUnits(
          inputElement.files
        ).subscribe(uploadStatus => {
          if (typeof uploadStatus === 'number') {
            if (uploadStatus < 0) {
              this.appService.dataLoading = false;
            } else {
              this.appService.dataLoading = uploadStatus;
            }
          } else {
            this.appService.dataLoading = false;
          }
        });
      }
    }
  }
}
