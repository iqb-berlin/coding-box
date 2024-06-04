import { Directive, HostListener } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { ChangePasswordComponent } from '../components/change-password/change-password.component';
import { AuthService } from '../../auth/service/auth.service';

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

    dialogRef.afterClosed().subscribe(async result => {
      if (result !== false) {
        const token = await this.authService.getToken();
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
