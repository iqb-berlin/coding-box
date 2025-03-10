import { Component } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AppService } from '../../services/app.service';
import { AppInfoComponent } from '../app-info/app-info.component';
import { UserWorkspacesAreaComponent } from '../../workspace/components/user-workspaces-area/user-workspaces-area.component';
import { BackendService } from '../../services/backend.service';
import { WorkspaceFullDto } from '../../../../../../api-dto/workspaces/workspace-full-dto';

@Component({
  selector: 'coding-box-home',
  // eslint-disable-next-line max-len
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, ReactiveFormsModule, TranslateModule, AppInfoComponent, UserWorkspacesAreaComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {
  constructor(
    public appService: AppService,
    public backendService: BackendService
  ) {}

  workspaces: WorkspaceFullDto[] = [];

  ngOnInit(): void {
    this.workspaces = this.appService.authData.workspaces;
    setTimeout(() => { this.workspaces = this.appService.authData.workspaces; }, 200);
  }

  protected readonly Number = Number;
}
