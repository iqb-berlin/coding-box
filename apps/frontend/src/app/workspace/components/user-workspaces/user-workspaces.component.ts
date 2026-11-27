import {
  afterRenderEffect, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel, MatPrefix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { AuthService } from '../../../core/services/auth.service';
import { AppService, AuthBootstrapStatus } from '../../../core/services/app.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-user-workspaces',
  templateUrl: './user-workspaces.component.html',
  styleUrls: ['./user-workspaces.component.scss'],
  imports: [
    RouterLink, TranslateModule, MatButton, MatFormField, MatLabel, MatPrefix, MatInput, MatIcon, MatProgressSpinner
  ]
})

export class UserWorkspacesComponent {
  private readonly destroyRef = inject(DestroyRef);
  protected authService = inject(AuthService);
  protected appService = inject(AppService);
  readonly workspaces = input<WorkspaceFullDto[]>([]);
  readonly authBootstrapStatus = input<AuthBootstrapStatus>('checking');
  readonly authDataLoaded = input(false);
  protected readonly authDataReloadRunning = signal(false);
  private readonly uiTranslate = injectUiTranslator();

  protected workspaceLabel(workspace: WorkspaceFullDto): string {
    return workspace.name || this.uiTranslate('ui-text.user-workspaces.unnamed', { id: workspace.id });
  }

  protected readonly searchQuery = signal('');
  protected readonly needsSearch = signal(false);
  private readonly results = viewChild<ElementRef<HTMLElement>>('results');
  private readonly searchSlot = viewChild<ElementRef<HTMLElement>>('searchSlot');

  protected readonly filteredWorkspaces = computed(() => {
    const workspaces = this.workspaces();
    const query = this.searchQuery().trim().toLowerCase();
    return query ?
      workspaces.filter(workspace => this.workspaceLabel(workspace).toLowerCase().includes(query)) :
      workspaces;
  });

  constructor() {
    afterRenderEffect({ read: onCleanup => {
      const results = this.results()?.nativeElement;
      const slot = this.searchSlot()?.nativeElement;
      const viewport = results?.closest<HTMLElement>('.app-main');
      if (!results || !slot || !viewport || this.searchQuery()) return;

      const measure = () => {
        // Compare the unfiltered list at scroll origin, without the space occupied by search.
        const listEnd = results.getBoundingClientRect().bottom + viewport.scrollTop - slot.getBoundingClientRect().height;
        this.needsSearch.set(listEnd > viewport.getBoundingClientRect().bottom + 0.5);
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(viewport);
      observer.observe(results);
      if (results.parentElement) observer.observe(results.parentElement);
      onCleanup(() => observer.disconnect());
    } });
  }

  protected get authDataErrorMessage(): string {
    if (this.appService.authDataFailureCode === 'configuration-error') return 'error.auth_configuration_error_message';
    if (this.appService.authDataFailureCode === 'provider-unavailable') return 'error.auth_provider_unavailable_message';
    return this.appService.authDataFailureStatus === 401 ? 'error.backend_auth_rejected_message' : 'home.auth-data-load-error';
  }

  protected get showLoading(): boolean {
    const authBootstrapStatus = this.authBootstrapStatus();
    return this.authService.isLoggedIn() === true &&
      !this.authDataLoaded() &&
      (authBootstrapStatus === 'checking' || authBootstrapStatus === 'backend-login-running');
  }

  protected get showSessionExpired(): boolean {
    if (!this.authService.isLoggedIn()) return this.appService.needsReAuthentication;
    return !this.authDataLoaded() && this.authBootstrapStatus() === 'session-expired';
  }

  protected get showAuthDataError(): boolean {
    const authBootstrapStatus = this.authBootstrapStatus();
    return this.authService.isLoggedIn() === true &&
      !this.authDataLoaded() &&
      (authBootstrapStatus === 'auth-data-failed' || authBootstrapStatus === 'ready');
  }

  protected get showEmptyWorkspaces(): boolean {
    return this.authService.isLoggedIn() === true &&
      this.authDataLoaded() &&
      (this.workspaces() || []).length === 0;
  }

  reloadAuthData(): void {
    if (this.authDataReloadRunning()) {
      return;
    }

    this.authDataReloadRunning.set(true);
    this.appService.retryAuthDataLoad()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          this.authDataReloadRunning.set(false);
        },
        complete: () => {
          this.authDataReloadRunning.set(false);
        }
      });
  }

  login(): void {
    this.authService.login(this.appService.reAuthenticationReturnUrl);
  }
}
