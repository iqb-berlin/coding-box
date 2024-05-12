import { Directive, HostListener } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { AppService } from '../../services/app.service';
import { BackendService } from '../../services/backend.service';
import { AuthService } from '../../auth/service/auth.service';
import { ChangePasswordComponent } from '../change-password/change-password.component';

@Directive({
  selector: '[codingBoxChangePassword]',
  standalone: true
})
export class ChangePasswordDirective {
  constructor(
    private changePasswordDialog: MatDialog,
    private snackBar: MatSnackBar,
    private translateService: TranslateService,
    private authService: AuthService
  ) {
  }

  @HostListener('click')
  async changePassword() {
    const dialogRef = this.changePasswordDialog.open(ChangePasswordComponent, {
      width: '400px'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result !== false) {
        const token = this.authService.getToken();
        this.authService.setPassword(result.controls.pw_new1.value,token).subscribe(
          respOk => {
            this.snackBar.open(
              respOk ?
                this.translateService.instant('user-profile.new-password') :
                this.translateService.instant('user-profile.new-password-error'),
              respOk ?
                this.translateService.instant('user-profile.ok') :
                this.translateService.instant('user-profile.error'),
              { duration: 3000 }
            );
          }
        );
      }
    });
  }
}
