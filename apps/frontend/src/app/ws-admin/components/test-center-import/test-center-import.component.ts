import {
  Component
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import {
  MatDialogContent, MatDialogActions, MatDialogClose
} from '@angular/material/dialog';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import {
  FormsModule,
  ReactiveFormsModule, UntypedFormBuilder, UntypedFormGroup, Validators
} from '@angular/forms';
import { MatInput } from '@angular/material/input';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
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
  responses:string,
  definitions:string,
  units:string,
  player:string,
  codings:string,
  logs:string,
  testTakers:string,
  booklets:string
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
  // eslint-disable-next-line max-len
  imports: [MatDialogContent, MatLabel, MatDialogActions, MatButton, MatDialogClose, TranslateModule, MatFormField, ReactiveFormsModule, MatInput, MatSelect, MatOption, MatCheckbox, MatProgressSpinner, MatError, FormsModule]
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
      testCenter: this.fb.control('', [Validators.required]),
      testCenterIndividual: this.fb.control({ value: '', disabled: true }, [Validators.required])

    });
    this.importFilesForm = this.fb.group({
      workspace: this.fb.control('', [Validators.required]),
      responses: this.fb.control(false),
      definitions: this.fb.control(false),
      units: this.fb.control(false),
      player: this.fb.control(false),
      codings: this.fb.control(false),
      logs: this.fb.control(false),
      testTakers: this.fb.control(false),
      booklets: this.fb.control(false)
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
    const url:string = this.loginForm.get('testCenterIndividual')?.value;
    this.testCenterInstance = this.testCenters.filter(
      testcenter => testcenter.id === this.loginForm.get('testCenter')?.value);
    this.backendService.authenticate(name, pw, this.testCenterInstance[0]?.id.toString(), url).pipe(
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

  isIndividualTcSelected(value:number): void {
    if (value !== 6) {
      this.loginForm.get('testCenterIndividual')?.disable();
    } else {
      this.loginForm.get('testCenterIndividual')?.enable();
    }
  }

  importWorkspaceFiles(): void {
    const formValues = {
      testCenter: this.loginForm.get('testCenter')?.value,
      workspace: this.importFilesForm.get('workspace')?.value,
      testCenterIndividual: this.loginForm.get('testCenterIndividual')?.value || '',
      importOptions: {
        definitions: this.importFilesForm.get('definitions')?.value,
        responses: this.importFilesForm.get('responses')?.value,
        units: this.importFilesForm.get('units')?.value,
        player: this.importFilesForm.get('player')?.value,
        codings: this.importFilesForm.get('codings')?.value,
        logs: this.importFilesForm.get('logs')?.value,
        testTakers: this.importFilesForm.get('testTakers')?.value,
        booklets: this.importFilesForm.get('booklets')?.value
      }
    };

    this.uploadData = {} as Result;

    const hasSelectedFiles = Object.values(formValues.importOptions).some(value => !!value);

    if (hasSelectedFiles) {
      this.filesSelectionError = false;
      this.isUploadingFiles = true;

      this.backendService
        .importWorkspaceFiles(
          this.appService.selectedWorkspaceId,
          formValues.workspace,
          formValues.testCenter,
          formValues.testCenterIndividual,
          this.authToken,
          formValues.importOptions
        )
        .subscribe({
          next: data => {
            this.uploadData = data;
            this.isUploadingFiles = false;
          },
          error: () => {
            this.isUploadingFiles = false;
          }
        });
    } else {
      this.filesSelectionError = true;
    }
  }
}
