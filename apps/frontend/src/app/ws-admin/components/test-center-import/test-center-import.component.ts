import {
  Component
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import {
  MatDialogContent, MatDialogActions, MatDialogClose
} from '@angular/material/dialog';
import { MatError, MatFormField } from '@angular/material/form-field';
import {
  ReactiveFormsModule, UntypedFormBuilder, UntypedFormGroup, Validators
} from '@angular/forms';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatRadioButton, MatRadioGroup } from '@angular/material/radio';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
// eslint-disable-next-line import/no-cycle
import { catchError, of } from 'rxjs';
// eslint-disable-next-line import/no-cycle
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { WorkspaceAdminService } from '../../services/workspace-admin.service';

export type ServerResponse = {
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

export type WorkspaceAdmin = {
  label: string,
  id: string,
  type: string,
  flags: {
    mode: string
  }
};

// type ServerFilesResponse = {
//   Booklet:[],
//   Ressource:Ressource[],
//   Unit:[],
//   Testtakers:[],
// };

// type Ressource = {
//   name: string,
//   size: number,
//   modificationTime: number,
//   type: string,
//   id: string,
//   report: [],
//   info: {
//     label: string,
//     description: string
//   }
// };

export type ImportOptions = {
  responses:string, definitions:string, units:string, player:string, codings:string
};

export type Testcenter = {
  id:number,
  label:string
};

export type Result = {
  success: boolean,
  testFiles: number,
  responses: number,
  logs: number
};

@Component({
  selector: 'coding-box-test-center-import',
  templateUrl: 'test-center-import.component.html',
  styleUrls: ['./test-center-import.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatDialogContent, MatIcon, MatDialogActions, MatButton, MatDialogClose, TranslateModule, MatFormField, ReactiveFormsModule, MatInput, MatSelect, MatOption, MatRadioGroup, MatRadioButton, MatCheckbox, MatProgressSpinner, MatError]
})

export class TestCenterImportComponent {
  testCenters: Testcenter[] = [{
    id: 1,
    label: 'Testcenter 1'
  }, {
    id: 2,
    label: 'Testcenter 2'
  },
  {
    id: 3,
    label: 'Testcenter 3'
  },
  {
    id: 4,
    label: 'Testcenter 4'
  },
  {
    id: 5,
    label: 'Testcenter 5'
  }];

  authToken: string = '';
  workspaces: WorkspaceAdmin[] = [];
  loginForm: UntypedFormGroup;
  importFilesForm: UntypedFormGroup;
  authenticationError: boolean = false;
  filesSelectionError: boolean = false;
  authenticated: boolean = false;
  isUploadingFiles: boolean = false;
  uploadData!: Result;
  testCenterInstance: Testcenter[] = [];
  constructor(private backendService: BackendService,
              private workspaceAdminService: WorkspaceAdminService,
              private fb: UntypedFormBuilder,
              private appService: AppService) {
    this.loginForm = this.fb.group({
      name: this.fb.control('', [Validators.required, Validators.minLength(1)]),
      pw: this.fb.control('', [Validators.required, Validators.minLength(1)]),
      testCenter: this.fb.control('2', [Validators.required])
    });
    this.importFilesForm = this.fb.group({
      workspace: this.fb.control('', [Validators.required]),
      responses: this.fb.control(false),
      definitions: this.fb.control(false),
      units: this.fb.control(false),
      player: this.fb.control(false),
      codings: this.fb.control(false)
    });
  }

  ngOnInit(): void {
    if (this.workspaceAdminService.getAuthToken()) {
      this.authenticated = true;
      this.authToken = this.workspaceAdminService.getAuthToken();
      this.workspaces = this.workspaceAdminService.getClaims();
      this.testCenterInstance = this.workspaceAdminService.getlastTestcenterInstance();
    }
  }

  authenticate(): void {
    const name = this.loginForm.get('name')?.value;
    const pw = this.loginForm.get('pw')?.value;
    this.testCenterInstance = this.testCenters.filter(
      testcenter => testcenter.id === this.loginForm.get('testCenter')?.value);
    this.backendService.authenticate(name, pw, this.testCenterInstance[0].id.toString()).pipe(
      catchError(() => {
        this.authenticationError = true;
        return of();
      })).subscribe(response => {
      if (!response) {
        this.authenticationError = true;
        return;
      }
      this.authToken = response.token;
      this.authenticationError = false;
      this.workspaceAdminService.setLastAuthToken(response.token);
      this.workspaceAdminService.setClaims(response.claims.workspaceAdmin);
      this.workspaceAdminService.setlastTestcenterInstance(this.testCenterInstance);
      this.workspaces = response.claims.workspaceAdmin;
      this.authenticated = true;
    });
  }

  logout(): boolean {
    this.authenticated = false;
    this.authToken = '';
    this.workspaceAdminService.setLastAuthToken('');
    this.workspaceAdminService.setClaims([]);
    this.workspaceAdminService.setlastTestcenterInstance([]);
    this.workspaces = [];
    return true;
  }

  importWorkspaceFiles(): void {
    const testCenter = this.loginForm.get('testCenter')?.value;
    const workspace = this.importFilesForm.get('workspace')?.value;
    const definitions = this.importFilesForm.get('definitions')?.value;
    const responses = this.importFilesForm.get('responses')?.value;
    const player = this.importFilesForm.get('player')?.value;
    const units = this.importFilesForm.get('units')?.value;
    const codings = this.importFilesForm.get('codings')?.value;

    const importOptions = {
      definitions: definitions,
      responses: responses,
      units: units,
      player: player,
      codings: codings
    };
    this.uploadData = {} as Result;
    if (definitions || responses || player || codings || units) {
      this.filesSelectionError = false;
      this.isUploadingFiles = true;
      this.backendService.importWorkspaceFiles(
        this.appService.selectedWorkspaceId,
        workspace,
        testCenter,
        this.authToken,
        importOptions)
        .subscribe(data => {
          this.uploadData = data;
          this.isUploadingFiles = false;
        });
    } else {
      this.filesSelectionError = true;
    }
  }
}
