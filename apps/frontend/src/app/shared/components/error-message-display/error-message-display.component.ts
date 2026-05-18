import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { AppService } from '../../../core/services/app.service';
import { AuthService } from '../../../core/services/auth.service';
import {
  AppHttpError,
  AppHttpErrorRequest
} from '../../../core/interceptors/app-http-error.class';

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
  private router = inject(Router);
  expandedErrorIds = new Set<number>();

  get showGlobalReAuthenticationMessage(): boolean {
    return this.appService.needsReAuthentication && !this.isHomeRoute();
  }

  dismissError(errorId: number): void {
    this.appService.errorMessages = this.appService.errorMessages.filter((e: AppHttpError) => e.id !== errorId);
    this.expandedErrorIds.delete(errorId);
  }

  dismissBackendUnavailable(): void {
    this.appService.setBackendUnavailable(false);
  }

  dismissReAuthentication(): void {
    this.appService.setNeedsReAuthentication(false);
  }

  handleLogin(): void {
    this.authService.login(this.appService.reAuthenticationReturnUrl);
  }

  toggleErrorDetails(errorId: number): void {
    if (this.expandedErrorIds.has(errorId)) {
      this.expandedErrorIds.delete(errorId);
      return;
    }

    this.expandedErrorIds.add(errorId);
  }

  isErrorDetailsExpanded(errorId: number): boolean {
    return this.expandedErrorIds.has(errorId);
  }

  hasErrorDetails(error: AppHttpError): boolean {
    return this.getAffectedRequests(error).length > 0;
  }

  getAffectedRequests(error: AppHttpError): AppHttpErrorRequest[] {
    if (error.affectedRequests?.length) {
      return error.affectedRequests;
    }

    if (error.method || error.urlWithParams) {
      return [{
        method: error.method,
        urlWithParams: error.urlWithParams
      }];
    }

    return [];
  }

  private isHomeRoute(): boolean {
    return this.router.url === '/home' || this.router.url.startsWith('/home?');
  }
}
