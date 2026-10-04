import { FormControl, FormGroup } from '@angular/forms';

export type EditUserForm = FormGroup<{
  username: FormControl<string>;
  isAdmin: FormControl<boolean>;
}>;

export type CreateUserForm = FormGroup<{
  name: FormControl<string>;
  isAdmin: FormControl<boolean>;
  firstName?: FormControl<string>;
  lastName?: FormControl<string>;
  email?: FormControl<string>;
}>;
