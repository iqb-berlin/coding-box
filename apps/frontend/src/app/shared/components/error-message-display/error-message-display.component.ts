import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { AppService } from '../../../core/services/app.service';
import { AuthService } from '../../../core/services/auth.service';
import { AppHttpError } from '../../../core/interceptors/app-http-error.class';

@Component({
  selector: 'app-error-message-display',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule, TranslateModule],
  templateUrl: './error-message-display.component.html',
  styleUrls: ['./error-message-display.component.scss']
})
export class ErrorMessageDisplayComponent {
  appService: AppService = inject(AppService);
  authService = inject(AuthService);

  dismissError(errorId: number): void {
    this.appService.errorMessages = this.appService.errorMessages.filter((e: AppHttpError) => e.id !== errorId);
  }

  dismissBackendUnavailable(): void {
    this.appService.setBackendUnavailable(false);
  }

  dismissReAuthentication(): void {
    this.appService.setNeedsReAuthentication(false);
  }

  handleLogin(): void {
    this.authService.login();
  }
}
