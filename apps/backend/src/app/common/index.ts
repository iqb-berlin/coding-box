// Common entities used across multiple feature modules
// Re-export default exports as named exports
import FileUploadDefault from './entities/file_upload.entity';
// eslint-disable-next-line import/no-cycle
import PersonsDefault from './entities/persons.entity';
import WorkspaceDefault from './entities/workspace.entity';
// eslint-disable-next-line import/no-cycle
export { ResponseEntity } from './entities/response.entity';
export { Unit } from './entities/unit.entity';
export { Job } from './entities/job.entity';

export { FileUploadDefault as FileUpload };
export { PersonsDefault as Persons };
export { WorkspaceDefault as Workspace };

// Also export as default for backward compatibility
export { default as FileUploadEntity } from './entities/file_upload.entity';
export { default as PersonsEntity } from './entities/persons.entity';
export { default as WorkspaceEntity } from './entities/workspace.entity';

// Export interfaces from entities
export type { StructuredFileData } from './entities/file_upload.entity';

// Common types used across multiple feature modules
export * from './types/shared-types';
