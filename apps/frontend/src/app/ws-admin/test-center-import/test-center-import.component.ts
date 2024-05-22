import {
  Component
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  MatDialogContent, MatDialogActions, MatDialogClose
} from '@angular/material/dialog';
import { MatFormField } from '@angular/material/form-field';
import {
  ReactiveFormsModule, UntypedFormBuilder, UntypedFormGroup, Validators
} from '@angular/forms';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { MatCheckbox } from '@angular/material/checkbox';
import { BackendService } from '../../services/backend.service';
import { AppService } from '../../services/app.service';

type ServerResponse = {
  token: string,
  displayName: string,
  customTexts: unknown,
  flags: [],
  claims: {
    workspaceAdmin: WorkspaceAdmin[],
  },
  groupToken: null,
  access: {
    workspaceAdmin: string[],
  }
};

type WorkspaceAdmin = {
  label: string,
  id: string,
  type: string,
  flags: {
    mode: string
  }
};

type ServerFilesResponse = {
  Booklet:[],
  Ressource:Ressource[],
  Unit:[],
  Testtakers:[],
};

type Ressource = {
  name: string,
  size: number,
  modificationTime: number,
  type: string,
  id: string,
  report: [],
  info: {
    label: string,
    description: string
  }
};

export type ImportOptions = {
  responses:string, definitions:string, units:string, player:string
};

@Component({
  selector: 'coding-box-test-center-import',
  templateUrl: 'test-center-import.component.html',
  styleUrls: ['./test-center-import.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatDialogContent, MatIcon, MatDialogActions, MatButton, MatDialogClose, TranslateModule, MatFormField, ReactiveFormsModule, MatInput, MatSelect, MatOption, MatRadioGroup, MatRadioButton, MatCheckbox]
})

export class TestCenterImportComponent {
  authToken: string = '';
  workspaces: WorkspaceAdmin[] = [];
  loginForm: UntypedFormGroup;
  importFilesForm: UntypedFormGroup;
  authenticationError: boolean = false;
  authenticated: boolean = false;
  uploadError: boolean = false;
  uploadedFiles: boolean = false;
  constructor(private backendService: BackendService,
              private fb: UntypedFormBuilder,
              private appService: AppService) {
    this.loginForm = this.fb.group({
      name: this.fb.control('', [Validators.required, Validators.minLength(1)]),
      pw: this.fb.control('', [Validators.required, Validators.minLength(1)]),
      testcenter: this.fb.control('2', [Validators.required])
    });
    this.importFilesForm = this.fb.group({
      workspace: this.fb.control('', [Validators.required]),
      responses: this.fb.control(true),
      definitions: this.fb.control(true),
      units: this.fb.control(true),
      player: this.fb.control(true)

    });
  }

  authenticate(): void {
    const name = this.loginForm.get('name')?.value;
    const pw = this.loginForm.get('pw')?.value;
    const testcenter = this.loginForm.get('testcenter')?.value;
    this.backendService.authenticate(name, pw, testcenter).subscribe((response:ServerResponse) => {
      if (!response) {
        this.authenticationError = true;
        return;
      }
      this.authenticationError = false;
      this.authenticated = true;
      this.authToken = response.token;
      this.workspaces = response.claims.workspaceAdmin;
    });
  }

  importWorkspaceFiles(): void {
    const testcenter = this.loginForm.get('testcenter')?.value;
    const workspace = this.importFilesForm.get('workspace')?.value;
    const definitions = this.importFilesForm.get('definitions')?.value;
    const responses = this.importFilesForm.get('responses')?.value;
    const player = this.importFilesForm.get('player')?.value;
    const units = this.importFilesForm.get('units')?.value;

    const importOptions = {
      definitions: definitions,
      responses: responses,
      units: units,
      player: player
    };
    this.appService.dataLoading = true;
    this.backendService.importWorkspaceFiles(workspace, testcenter, this.authToken, importOptions)
      .subscribe((response:ServerFilesResponse) => {
        this.appService.dataLoading = false;
        if (!response) {
          this.uploadedFiles = false;
          this.uploadError = true;
          return;
        }
        this.uploadedFiles = true;
        this.uploadError = false;
      });
  }
}
