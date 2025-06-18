import { Component, inject } from '@angular/core';
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
  imports: [MatDialogTitle, MatDialogContent, FormsModule, ReactiveFormsModule, MatFormField, MatInput, MatDialogActions, MatButton, MatDialogClose, TranslateModule]
})
export class EditWorkspaceComponent {
  private fb = inject(UntypedFormBuilder);
  data = inject<Data>(MAT_DIALOG_DATA);

  editWorkspaceForm: UntypedFormGroup;
  name = this.data.ws?.name;
  constructor() {
    this.editWorkspaceForm = this.fb.group({
      name: this.fb.control(this.name, [Validators.required, Validators.minLength(3)])
    });
  }
}
