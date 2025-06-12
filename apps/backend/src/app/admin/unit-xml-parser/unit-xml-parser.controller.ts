import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { UnitXmlParserService } from '../../database/services/unit-xml-parser.service';

interface BaseVariableDto {
  id: string;
  type: string;
  format: string;
  nullable: string;
}

@ApiTags('Unit XML Parser')
@Controller('admin/unit-xml-parser')
export class UnitXmlParserController {
  constructor(private unitXmlParserService: UnitXmlParserService) {}

  @Get('base-variables')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all base variables from unit XML files', description: 'Parses all unit XML files and extracts the base variables with their attributes' })
  @ApiOkResponse({
    description: 'List of base variables retrieved successfully',
    type: [Object],
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'ID of the variable' },
          type: { type: 'string', description: 'Type of the variable' },
          format: { type: 'string', description: 'Format of the variable' },
          nullable: { type: 'string', description: 'Whether the variable is nullable' }
        }
      }
    }
  })
  async getBaseVariables(): Promise<BaseVariableDto[]> {
    return this.unitXmlParserService.parseBaseVariables();
  }
}
