import {
  Component, OnInit, OnDestroy, inject
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import {
  Subscription, catchError, forkJoin, of
} from 'rxjs';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppService, AuthBootstrapStatus } from '../../core/services/app.service';
import { AuthService } from '../../core/services/auth.service';
import { AppInfoComponent } from '../app-info/app-info.component';
import { AuthDataDto } from '../../../../../../api-dto/auth-data-dto';
import { UserWorkspacesAreaComponent } from '../../workspace/components/user-workspaces-area/user-workspaces-area.component';
import { WorkspaceFullDto } from '../../../../../../api-dto/workspaces/workspace-full-dto';
import { UserService } from '../../shared/services/user/user.service';
import {
  AUTH_QUERY_PARAM_ACCESS_DENIED,
  AUTH_QUERY_PARAM_AUTH_DATA_FAILED,
  AUTH_QUERY_PARAM_SESSION_EXPIRED
} from '../../core/guards/auth-redirect';
import {
  getCurrentUserWorkspaceAccesses,
  hasOnlyPersonalCodingAccess
} from '../../shared/utils/workspace-access';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'coding-box-home',
  standalone: true,
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    ReactiveFormsModule,
    TranslateModule,
    AppInfoComponent,
    UserWorkspacesAreaComponent
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit, OnDestroy {
  readonly appService: AppService = inject(AppService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private userService = inject(UserService);
  private authService = inject(AuthService);

  workspaces: WorkspaceFullDto[] = [];
  appVersion = environment.appVersion;
  authData = AppService.defaultAuthData;
  authBootstrapStatus: AuthBootstrapStatus = 'checking';
  private isPersonalCodingJobsRedirectChecked = false;
  private authDataRefreshRequested = false;
  private authDataFailedQueryParamActive = false;
  private authDataFailedMessageShown = false;

  private authSubscription?: Subscription;
  private authBootstrapSubscription?: Subscription;
  private queryParamsSubscription?: Subscription;

  ngOnInit(): void {
    this.authSubscription = this.appService.authData$.subscribe((authData: AuthDataDto) => {
      if (authData) {
        this.authData = authData;
        this.workspaces = authData.workspaces;
        if (!this.isPersonalCodingJobsRedirectChecked && authData.userId > 0 && !authData.isAdmin) {
          this.redirectPureCoderToPersonalCodingJobs(authData.userId);
        }
        if (authData.userId > 0) {
          this.resolveAuthDataFailedQueryParam();
        }
      }
    });

    this.authBootstrapSubscription = this.appService.authBootstrapStatus$
      .subscribe(status => {
        this.authBootstrapStatus = status;

        if (status === 'ready' && !this.authDataRefreshRequested) {
          this.authDataRefreshRequested = true;
          this.refreshHomeAuthDataIfNeeded();
        }

        this.resolveAuthDataFailedQueryParam();
      });

    this.queryParamsSubscription = this.route.queryParams.subscribe(params => {
      if (params.error) {
        this.showErrorMessage(params.error);
      }
      if (params.auth) {
        this.handleAuthQueryParams(params);
      } else {
        this.resetAuthDataFailedQueryParamState();
      }
    });
  }

  private refreshHomeAuthDataIfNeeded(): void {
    if (this.authData.userId > 0) {
      return;
    }

    this.appService.refreshAuthData();
  }

  private redirectPureCoderToPersonalCodingJobs(userId: number): void {
    this.isPersonalCodingJobsRedirectChecked = true;

    if (!this.workspaces || this.workspaces.length === 0) {
      return;
    }

    const workspaceIds = this.workspaces.map(workspace => workspace.id);
    const observables = workspaceIds.map(workspaceId => this.userService.getUsers(workspaceId));

    forkJoin(observables).pipe(catchError(() => of(null))).subscribe(responses => {
      if (!responses) {
        return;
      }

      const currentUserAccess = getCurrentUserWorkspaceAccesses(responses, userId);
      if (hasOnlyPersonalCodingAccess(currentUserAccess)) {
        this.router.navigate(['/coding']);
      }
    });
  }

  /**
   * Shows an error message based on the error code
   * @param errorCode The error code from the query parameters
   */
  private showErrorMessage(errorCode: string): void {
    let message;

    switch (errorCode) {
      case 'token_missing':
        message = 'Kein Authorisierungs-Token angegeben';
        break;
      case 'token_expired':
        message = 'Authentisierungs-Token ist abgelaufen';
        break;
      case 'token_invalid':
        message = 'Authentisierungs-Token ist ungültig';
        break;
      default:
        message = 'Ein Fehler ist aufgetreten';
        break;
    }

    this.snackBar.open(message, 'Schließen', {
      duration: 5000,
      panelClass: ['snackbar-error']
    });
  }

  private handleAuthQueryParams(params: Params): void {
    const authReason = String(params.auth);
    const returnUrl = typeof params.returnUrl === 'string' ? params.returnUrl : undefined;

    switch (authReason) {
      case AUTH_QUERY_PARAM_SESSION_EXPIRED:
        this.resetAuthDataFailedQueryParamState();
        if (this.authService.isLoggedIn() === false) {
          this.appService.requireReAuthentication(returnUrl);
        }
        break;
      case AUTH_QUERY_PARAM_AUTH_DATA_FAILED:
        this.authDataFailedQueryParamActive = true;
        this.authDataFailedMessageShown = false;
        this.resolveAuthDataFailedQueryParam();
        break;
      case AUTH_QUERY_PARAM_ACCESS_DENIED:
        this.resetAuthDataFailedQueryParamState();
        this.snackBar.open(
          'Sie haben keinen Zugriff auf diesen Bereich.',
          'Schließen',
          {
            duration: 5000,
            panelClass: ['snackbar-error']
          }
        );
        break;
      default:
        this.resetAuthDataFailedQueryParamState();
        break;
    }
  }

  private resolveAuthDataFailedQueryParam(): void {
    if (!this.authDataFailedQueryParamActive) {
      return;
    }

    if (this.authData.userId > 0 || this.authBootstrapStatus === 'ready') {
      this.clearAuthDataFailedQueryParams();
      return;
    }

    if (this.authBootstrapStatus === 'auth-data-failed' && !this.authDataFailedMessageShown) {
      this.authDataFailedMessageShown = true;
      this.snackBar.open(
        'Ihre Anmeldung wurde erkannt, aber die Sitzungsdaten konnten nicht geladen werden. Bitte laden Sie die Seite neu oder melden Sie sich erneut an.',
        'Schließen',
        {
          duration: 8000,
          panelClass: ['snackbar-error']
        }
      );
    }
  }

  private clearAuthDataFailedQueryParams(): void {
    this.resetAuthDataFailedQueryParamState();

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        auth: null,
        returnUrl: null
      },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  private resetAuthDataFailedQueryParamState(): void {
    this.authDataFailedQueryParamActive = false;
    this.authDataFailedMessageShown = false;
  }

  ngOnDestroy(): void {
    this.authSubscription?.unsubscribe();
    this.authBootstrapSubscription?.unsubscribe();
    this.queryParamsSubscription?.unsubscribe();
  }

  protected readonly Number = Number;
}
