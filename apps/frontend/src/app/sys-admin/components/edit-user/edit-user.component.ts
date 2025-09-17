import {
  MAT_DIALOG_DATA, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose
} from '@angular/material/dialog';
import { Component, inject } from '@angular/core';
import {
  UntypedFormBuilder, UntypedFormGroup, Validators, FormsModule, ReactiveFormsModule
} from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';

import { MatInput } from '@angular/material/input';
import { MatFormField } from '@angular/material/form-field';

type Data = {
  newUser:string;
  username: string;
  isAdmin: boolean;
};
@Component({
  selector: 'coding-box-edit-user',
  templateUrl: './edit-user.component.html',
  styleUrls: ['./edit-user.component.scss'],
  imports: [MatDialogTitle, MatDialogContent, FormsModule, ReactiveFormsModule, MatFormField, MatInput, MatCheckbox, MatDialogActions, MatButton, MatDialogClose, TranslateModule]
})

export class EditUserComponent {
  private fb = inject(UntypedFormBuilder);
  data = inject<Data>(MAT_DIALOG_DATA);

  editUserForm: UntypedFormGroup;
  constructor() {
    this.editUserForm = this.fb.group({
      username: this.fb.control(this.data.username, [Validators.required]),
      isAdmin: this.fb.control(this.data.isAdmin, [Validators.required])
    });
  }
}
