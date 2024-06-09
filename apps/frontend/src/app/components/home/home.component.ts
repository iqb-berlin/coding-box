import { Component } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ReactiveFormsModule } from '@angular/forms';
import { JsonPipe, NgIf } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { UnitPlayerComponent } from '../../replay/components/unit-player/unit-player.component';
import { AppService } from '../../services/app.service';
import { AppInfoComponent } from '../app-info/app-info.component';
import { UserWorkspacesAreaComponent } from '../../workspace/user-workspaces-area/user-workspaces-area.component';

@Component({
  selector: 'coding-box-home',
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatFormFieldModule, MatInputModule, MatButtonModule, ReactiveFormsModule, NgIf, TranslateModule, UnitPlayerComponent, AppInfoComponent, UserWorkspacesAreaComponent, JsonPipe],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {
  constructor(
    public appService: AppService
  ) {}

  protected readonly Number = Number;
}
