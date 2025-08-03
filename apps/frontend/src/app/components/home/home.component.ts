import {
  Component, OnInit, OnDestroy, inject
} from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppService } from '../../services/app.service';
import { AppInfoComponent } from '../app-info/app-info.component';
import { UserWorkspacesAreaComponent } from '../../workspace/components/user-workspaces-area/user-workspaces-area.component';
import { WorkspaceFullDto } from '../../../../../../api-dto/workspaces/workspace-full-dto';
import { BackendService } from '../../services/backend.service';

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
  readonly appService = inject(AppService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private backendService = inject(BackendService);

  workspaces: WorkspaceFullDto[] = [];
  authData = AppService.defaultAuthData;
  private isCoderChecked = false;

  private authSubscription?: Subscription;

  ngOnInit(): void {
    this.appService.refreshAuthData();
    this.authSubscription = this.appService.authData$.subscribe(authData => {
      if (authData) {
        this.authData = authData;
        this.workspaces = authData.workspaces;

        // Check if user is a coder and redirect if needed
        if (!this.isCoderChecked && authData.userId > 0) {
          this.checkIfUserIsCoder(authData.userId);
        }
      }
    });

    this.route.queryParams.subscribe(params => {
      if (params.error) {
        this.showErrorMessage(params.error);
      }
    });
  }

  private checkIfUserIsCoder(userId: number): void {
    this.isCoderChecked = true;

    if (!this.workspaces || this.workspaces.length === 0) {
      return;
    }

    const firstWorkspaceId = this.workspaces[0].id;

    this.backendService.getWorkspaceUsers(firstWorkspaceId).subscribe(response => {
      const currentUser = response.data.find(user => user.userId === userId);

      if (currentUser && currentUser.accessLevel === 1) {
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

  ngOnDestroy(): void {
    this.authSubscription?.unsubscribe();
  }

  protected readonly Number = Number;
}
