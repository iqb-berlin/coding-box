import { Component, Inject } from '@angular/core';
import {
  UntypedFormBuilder, UntypedFormGroup, Validators, FormsModule, ReactiveFormsModule
} from '@angular/forms';
import {
  MAT_DIALOG_DATA, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose
} from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatInput } from '@angular/material/input';
import { MatFormField } from '@angular/material/form-field';

type Data = {
  title: string;
  saveButtonLabel: string;
  ws: {
    name: string;
  };

};

@Component({
  selector: 'coding-box-edit-workspace-group',
  templateUrl: './edit-workspace.component.html',
  styleUrls: ['./edit-workspace.component.scss'],
  // eslint-disable-next-line max-len
  imports: [MatDialogTitle, MatDialogContent, FormsModule, ReactiveFormsModule, MatFormField, MatInput, MatDialogActions, MatButton, MatDialogClose, TranslateModule]
})
export class EditWorkspaceComponent {
  editWorkspaceForm: UntypedFormGroup;
  name = this.data.ws?.name;
  constructor(private fb: UntypedFormBuilder,
              @Inject(MAT_DIALOG_DATA) public data: Data) {
    this.editWorkspaceForm = this.fb.group({
      name: this.fb.control(this.name, [Validators.required, Validators.minLength(3)])
    });
  }
}
