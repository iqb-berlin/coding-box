import {
  MAT_DIALOG_DATA, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose
} from '@angular/material/dialog';
import { Component, inject } from '@angular/core';
import {
  NonNullableFormBuilder, Validators, FormsModule, ReactiveFormsModule
} from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';

import { MatInput } from '@angular/material/input';
import { MatFormField } from '@angular/material/form-field';
import { EditUserForm } from '../../models/user-form.model';

export type EditUserData = {
  newUser?: boolean;
  username?: string;
  isAdmin?: boolean;
};
@Component({
  selector: 'coding-box-edit-user',
  templateUrl: './edit-user.component.html',
  styleUrls: ['./edit-user.component.scss'],
  imports: [MatDialogTitle, MatDialogContent, FormsModule, ReactiveFormsModule, MatFormField, MatInput, MatCheckbox, MatDialogActions, MatButton, MatDialogClose, TranslateModule]
})

export class EditUserComponent {
  private fb = inject(NonNullableFormBuilder);
  data = inject<EditUserData>(MAT_DIALOG_DATA);

  readonly editUserForm: EditUserForm;
  constructor() {
    this.editUserForm = this.fb.group({
      username: this.fb.control(this.data.username ?? '', [Validators.required]),
      isAdmin: this.fb.control(this.data.isAdmin ?? false, [Validators.required])
    });
  }
}
