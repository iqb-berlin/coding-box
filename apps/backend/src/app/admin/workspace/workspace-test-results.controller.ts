import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Admin Workspace Test Results (Deprecated)')
@Controller('admin/workspace')
export class WorkspaceTestResultsController {
  // This controller is deprecated and has been split into:
  // - WorkspaceTestResultsStatisticsController
  // - WorkspaceTestResultsManagementController
  // - WorkspaceTestResultsLogsController
  // - WorkspaceTestResultsResponseController
  // - WorkspaceTestResultsAnalysisController
  // - WorkspaceTestResultsImportController
  // - WorkspaceTestResultsExportController
}
