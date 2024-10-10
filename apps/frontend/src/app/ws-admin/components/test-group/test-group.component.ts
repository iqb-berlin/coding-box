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
  MatRow
} from '@angular/material/table';
import {
  Component, Inject, OnInit
} from '@angular/core';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { DatePipe, JsonPipe } from '@angular/common';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { HasSelectionValuePipe } from '../../../shared/pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../../shared/pipes/isAllSelected.pipe';
import { IsSelectedPipe } from '../../../shared/pipes/isSelected.pipe';
import { FileSizePipe } from '../../../shared/pipes/filesize.pipe';

@Component({
  selector: 'coding-box-test-group',
  templateUrl: './test-group.component.html',
  styleUrls: ['./test-group.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatButton, MatTooltip, WrappedIconComponent, FormsModule, TranslateModule, SearchFilterComponent, JsonPipe, HasSelectionValuePipe, IsAllSelectedPipe, IsSelectedPipe, MatProgressSpinner, DatePipe, FileSizePipe, MatAnchor, MatIcon]
})
export class TestGroupComponent implements OnInit {
  constructor(
    public dialogRef: MatDialogRef<TestGroupComponent>,
    @Inject(MAT_DIALOG_DATA) public data: string,
    private backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar,
    private translateService: TranslateService
  ) {
  }

  ngOnInit(): void {
    this.backendService.getTestPersons(1, this.data).subscribe(testPerson => {
      console.log(testPerson);
    });
    this.backendService.getTestGroupVarList(1, this.data).subscribe(vars => {
      console.log('VarList', vars);
    });
  }
}
