import { Component, OnInit, OnDestroy } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { AppService } from '../../services/app.service';
import { AppInfoComponent } from '../app-info/app-info.component';
// eslint-disable-next-line max-len
import { UserWorkspacesAreaComponent } from '../../workspace/components/user-workspaces-area/user-workspaces-area.component';
import { WorkspaceFullDto } from '../../../../../../api-dto/workspaces/workspace-full-dto';

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
  workspaces: WorkspaceFullDto[] = [];
  authData = AppService.defaultAuthData;

  private authSubscription?: Subscription;
  constructor(
    readonly appService: AppService
  ) {}

  ngOnInit(): void {
    this.authSubscription = this.appService.authData$.subscribe(authData => {
      this.authData = authData;
      this.workspaces = authData.workspaces;
    });
  }

  ngOnDestroy(): void {
    this.authSubscription?.unsubscribe();
  }

  protected readonly Number = Number;
}
