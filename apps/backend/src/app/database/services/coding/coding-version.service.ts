import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';

@Injectable()
export class CodingVersionService {
  private readonly logger = new Logger(CodingVersionService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>
  ) { }

  async resetCodingVersion(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    unitFilters?: string[],
    variableFilters?: string[]
  ): Promise<{
      affectedResponseCount: number;
      cascadeResetVersions: ('v2' | 'v3')[];
      message: string;
    }> {
    try {
      this.logger.log(
        `Starting reset for version ${version} in workspace ${workspaceId}, filters: units=${unitFilters?.join(
          ','
        )}, variables=${variableFilters?.join(',')}`
      );

      // Determine which versions to reset
      const versionsToReset: ('v1' | 'v2' | 'v3')[] = [version];
      if (version === 'v2') {
        versionsToReset.push('v3'); // Cascade: resetting v2 also resets v3
      }

      const baseQueryBuilder = this.responseRepository
        .createQueryBuilder('response')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true });

      if (unitFilters && unitFilters.length > 0) {
        baseQueryBuilder.andWhere('unit.name IN (:...unitNames)', {
          unitNames: unitFilters
        });
      }

      if (variableFilters && variableFilters.length > 0) {
        baseQueryBuilder.andWhere('response.variableid IN (:...variableIds)', {
          variableIds: variableFilters
        });
      }

      const countQueryBuilder = baseQueryBuilder.clone();
      const affectedResponseCount = await countQueryBuilder.getCount();

      if (affectedResponseCount === 0) {
        this.logger.log(`No responses found to reset for version ${version}`);
        return {
          affectedResponseCount: 0,
          cascadeResetVersions: version === 'v2' ? ['v3'] : [],
          message: `No responses found matching the filters for version ${version}`
        };
      }

      const updateObj: Record<string, null> = {};
      versionsToReset.forEach(v => {
        updateObj[`status_${v}`] = null;
        updateObj[`code_${v}`] = null;
        updateObj[`score_${v}`] = null;
      });

      const batchSize = 5000;
      let offset = 0;

      for (; ;) {
        const batchQueryBuilder = baseQueryBuilder
          .clone()
          .select(['response.id'])
          .orderBy('response.id', 'ASC')
          .skip(offset)
          .take(batchSize);

        const batchResponses = await batchQueryBuilder.getMany();
        if (batchResponses.length === 0) {
          break;
        }

        const batchIds = batchResponses.map(r => r.id);
        await this.responseRepository.update(
          {
            id: In(batchIds)
          },
          updateObj
        );

        offset += batchSize;
      }

      this.logger.log(
        `Reset successful: ${affectedResponseCount} responses cleared for version(s) ${versionsToReset.join(
          ', '
        )}`
      );

      return {
        affectedResponseCount,
        cascadeResetVersions: version === 'v2' ? ['v3'] : [],
        message: `Successfully reset ${affectedResponseCount} responses for version ${version}${version === 'v2' ? ' and v3 (cascade)' : ''
        }`
      };
    } catch (error) {
      this.logger.error(
        `Error resetting coding version ${version} in workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to reset coding version: ${error.message}`);
    }
  }
}
