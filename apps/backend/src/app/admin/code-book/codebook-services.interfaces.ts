import { Observable } from 'rxjs';
import { CodeBookContentSetting } from './codebook.interfaces';

/**
 * Interface for workspace service abstraction
 */
export interface IWorkspaceService {
  /**
   * Get the selected workspace ID
   */
  readonly selectedWorkspaceId: number;

  /**
   * Get the selected workspace name
   */
  readonly selectedWorkspaceName: string;

  /**
   * Check if there are unsaved changes in the workspace
   */
  isChanged(): boolean;
}

/**
 * Interface for workspace backend service abstraction
 */
export interface IWorkspaceBackendService {
  /**
   * Get missings profiles
   */
  getMissingsProfiles(): Observable<{ label: string }[]>;

  /**
   * Get coding book
   * @param workspaceId Workspace ID
   * @param missingsProfile Missings profile
   * @param contentOptions Content options
   * @param unitList Unit list
   */
  getCodingBook(
    workspaceId: number,
    missingsProfile: string,
    contentOptions: CodeBookContentSetting,
    unitList: number[]
  ): Observable<Blob | null>;
}

/**
 * Interface for app service abstraction
 */
export interface IAppService {
  /**
   * Set data loading state
   */
  dataLoading: boolean;
}

/**
 * Interface for unit selection component abstraction
 */
export interface IUnitSelectionComponent {
  /**
   * Workspace ID
   */
  workspace: number;

  /**
   * Event emitted when selection changes
   */
  selectionChanged: Observable<number[]>;
}
