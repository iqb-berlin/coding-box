import {
  MAT_DIALOG_DATA, MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose
} from '@angular/material/dialog';
import { Component, Inject } from '@angular/core';
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
  // eslint-disable-next-line max-len
  imports: [MatDialogTitle, MatDialogContent, FormsModule, ReactiveFormsModule, MatFormField, MatInput, MatCheckbox, MatDialogActions, MatButton, MatDialogClose, TranslateModule]
})

export class EditUserComponent {
  editUserForm: UntypedFormGroup;
  constructor(private fb: UntypedFormBuilder,
              @Inject(MAT_DIALOG_DATA) public data: Data) {
    this.editUserForm = this.fb.group({
      username: this.fb.control(this.data.username, [Validators.required]),
      isAdmin: this.fb.control(this.data.isAdmin, [Validators.required])
    });
  }
}
