import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { MatAnchor } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { UntypedFormGroup } from '@angular/forms';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { AppService } from '../../services/app.service';
import { BackendService } from '../../services/backend.service';

@Component({
  selector: 'coding-box-file-upload',
  templateUrl: './file-upload.component.html',
  styleUrls: ['./file-upload.component.scss'],
  standalone: true,
  imports: [MatAnchor, RouterLink, TranslateModule, MatIcon, TestCenterImportComponent]
})
export class FileUploadComponent {
  private uploadSubscription: Subscription | null = null;
  constructor(public appService:AppService,
              public backendService:BackendService,
              private TestCenterImportDialog: MatDialog
  ) { }

  onFileSelected(targetElement: EventTarget | null) {
    if (targetElement) {
      const inputElement = targetElement as HTMLInputElement;
      if (inputElement.files && inputElement.files.length > 0) {
        this.appService.dataLoading = true;
        console.log(inputElement,'inputElement.files',inputElement.files)
        this.uploadSubscription = this.backendService.uploadTestFiles(
          1,
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

  testCenterImport(): void {
    const dialogRef = this.TestCenterImportDialog.open(TestCenterImportComponent, {
      width: '600px',
      minHeight: '600px'
    });

    dialogRef.afterClosed().subscribe((result: boolean | UntypedFormGroup) => {
      if (typeof result !== 'undefined') {
        if (result !== false) {
          return true;
        }
      }
      return false;
    });
  }
}
