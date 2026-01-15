import {
  Controller,
  Post,
  Body,
  Res,
  UseGuards
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiBody,
  ApiTags
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { CodebookGenerationService } from '../../database/services/codebook-generation.service';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingCodebookController {
  constructor(
    private codebookGenerationService: CodebookGenerationService
  ) { }

  @Post(':workspace_id/coding/codebook')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Codebook generation parameters',
    schema: {
      type: 'object',
      properties: {
        missingsProfile: {
          type: 'string',
          description: 'Name of the missings profile to use',
          example: 'IQB-Standard'
        },
        contentOptions: {
          type: 'object',
          description: 'Options for codebook content generation',
          properties: {
            exportFormat: { type: 'string' },
            missingsProfile: { type: 'string' },
            hasOnlyManualCoding: { type: 'boolean' },
            hasGeneralInstructions: { type: 'boolean' },
            hasDerivedVars: { type: 'boolean' },
            hasOnlyVarsWithCodes: { type: 'boolean' },
            hasClosedVars: { type: 'boolean' },
            codeLabelToUpper: { type: 'boolean' },
            showScore: { type: 'boolean' },
            hideItemVarRelation: { type: 'boolean' }
          }
        },
        unitList: {
          type: 'array',
          items: { type: 'number' },
          description: 'List of unit IDs to include in the codebook'
        }
      },
      required: ['missingsProfile', 'contentOptions', 'unitList']
    }
  })
  @ApiOkResponse({
    description: 'Codebook generated successfully.',
    schema: {
      type: 'string',
      format: 'binary',
      description: 'Generated codebook file'
    }
  })
  async generateCodebook(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     missingsProfile: number;
                     contentOptions: {
                       exportFormat: string;
                       missingsProfile: string;
                       hasOnlyManualCoding: boolean;
                       hasGeneralInstructions: boolean;
                       hasDerivedVars: boolean;
                       hasOnlyVarsWithCodes: boolean;
                       hasClosedVars: boolean;
                       codeLabelToUpper: boolean;
                       showScore: boolean;
                       hideItemVarRelation: boolean;
                     };
                     unitList: number[];
                   },
                   @Res() res: Response
  ): Promise<void> {
    const { missingsProfile, contentOptions, unitList } = body;

    const codebook = await this.codebookGenerationService.generateCodebook(
      workspace_id,
      missingsProfile,
      contentOptions,
      unitList
    );

    if (!codebook) {
      res.status(404).send('Failed to generate codebook');
      return;
    }

    const contentType =
      contentOptions.exportFormat === 'docx' ?
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' :
        'application/json';

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=codebook.${contentOptions.exportFormat.toLowerCase()}`
    );
    res.send(codebook);
  }
}
