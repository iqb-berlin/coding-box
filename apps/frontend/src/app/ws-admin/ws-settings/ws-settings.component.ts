import {
  MatTable,
  MatColumnDef,
  MatHeaderCellDef,
  MatHeaderCell,
  MatCellDef,
  MatCell,
  MatHeaderRowDef,
  MatHeaderRow,
  MatRowDef,
  MatRow,
} from '@angular/material/table';
import {
  ViewChild, Component, OnInit, Output, EventEmitter
} from '@angular/core';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule,  } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { JsonPipe } from '@angular/common';
import { BackendService } from '../../services/backend.service';
import { AppService } from '../../services/app.service';
import { WrappedIconComponent } from '../../shared/wrapped-icon/wrapped-icon.component';
import { SearchFilterComponent } from '../../shared/search-filter/search-filter.component';
import { MatFormField } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';


@Component({
  selector: 'coding-box-test-persons',
  templateUrl: './ws-settings.component.html',
  styleUrls: ['./ws-settings.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatButton, MatTooltip, WrappedIconComponent, FormsModule, TranslateModule, SearchFilterComponent, JsonPipe, MatFormField, MatInput, CdkTextareaAutosize]
})
export class WsSettingsComponent  {
  authToken: string | null = null;

  constructor(
    private backendService: BackendService,
    private appService: AppService
  ) {
  }

}
