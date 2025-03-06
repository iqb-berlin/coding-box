import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { WsAccessRightsComponent } from '../ws-access-rights/ws-access-rights.component';

@Component({
    selector: 'coding-box-ws-settings',
    templateUrl: './ws-settings.component.html',
    styleUrls: ['./ws-settings.component.scss'],
    // eslint-disable-next-line max-len
    imports: [MatLabel, MatButton, FormsModule, TranslateModule, MatFormField, MatInput, CdkTextareaAutosize, WsAccessRightsComponent, WsAccessRightsComponent]
})
export class WsSettingsComponent {
  authToken: string | null = null;
  duration = 60;

  constructor(
    private backendService: BackendService,
    private appService: AppService
  ) {
  }

  createToken(): void {
    this.backendService
      .createToken(this.appService.selectedWorkspaceId, this.appService.loggedUser?.sub || '', this.duration)
      .subscribe(authToken => {
        this.authToken = authToken;
      });
  }
}
