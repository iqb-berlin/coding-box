import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import {
  FormControl, FormGroup, NonNullableFormBuilder, Validators, FormsModule, ReactiveFormsModule
} from '@angular/forms';
import {
  MAT_DIALOG_DATA, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose
} from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatInput } from '@angular/material/input';
import { MatFormField } from '@angular/material/form-field';

export type EditWorkspaceData = {
  title: string;
  saveButtonLabel: string;
  ws: {
    name: string;
  };

};

export type EditWorkspaceForm = FormGroup<{
  name: FormControl<string>;
}>;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-edit-workspace-group',
  templateUrl: './edit-workspace.component.html',
  styleUrls: ['./edit-workspace.component.scss'],
  imports: [MatDialogTitle, MatDialogContent, FormsModule, ReactiveFormsModule, MatFormField, MatInput, MatDialogActions, MatButton, MatDialogClose, TranslateModule]
})
export class EditWorkspaceComponent {
  private fb = inject(NonNullableFormBuilder);
  protected data = inject<EditWorkspaceData>(MAT_DIALOG_DATA);

  readonly editWorkspaceForm: EditWorkspaceForm;
  protected name = this.data.ws?.name ?? '';
  constructor() {
    this.editWorkspaceForm = this.fb.group({
      name: this.fb.control(this.name, [Validators.required, Validators.minLength(3)])
    });
  }
}
