import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CacheService } from './cache.service';
import Persons from '../database/entities/persons.entity';
import { Unit } from '../database/entities/unit.entity';
import { WorkspaceTestResultsService } from '../database/services/workspace-test-results.service';

@Injectable()
export class ResponseCacheSchedulerService {
  private readonly logger = new Logger(ResponseCacheSchedulerService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly workspaceTestResultsService: WorkspaceTestResultsService,
    @InjectRepository(Persons)
    private readonly personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>
  ) {}

  /**
   * Scheduled task to cache all possible replay URLs and their responses
   * Runs every night at 2:00 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async cacheAllResponses() {
    this.logger.log('Starting nightly task to cache all responses');

    try {
      // Get all workspaces with persons
      const workspaces = await this.getWorkspacesWithPersons();

      for (const workspace of workspaces) {
        const workspaceId = workspace.workspace_id;
        this.logger.log(`Caching responses for workspace ${workspaceId}`);

        // Get all test persons in this workspace
        const persons = await this.personsRepository.find({
          where: { workspace_id: workspaceId, consider: true }
        });

        for (const person of persons) {
          // Get all units for this person
          const units = await this.getUnitsForPerson(person.id);

          for (const unit of units) {
            // Create the connector string (login@code@bookletId)
            const connector = this.createConnector(person, unit.booklet.bookletinfo.name);

            try {
              // Cache the response
              await this.cacheResponse(workspaceId, connector, unit.alias);
            } catch (error) {
              this.logger.error(`Error caching response for workspace=${workspaceId}, testPerson=${connector}, unitId=${unit.alias}: ${error.message}`, error.stack);
            }
          }
        }
      }

      this.logger.log('Finished nightly caching of all responses');
    } catch (error) {
      this.logger.error(`Error in cacheAllResponses: ${error.message}`, error.stack);
    }
  }

  /**
   * Get all workspaces that have persons
   */
  private async getWorkspacesWithPersons(): Promise<{ workspace_id: number }[]> {
    return this.personsRepository
      .createQueryBuilder('person')
      .select('DISTINCT person.workspace_id', 'workspace_id')
      .where('person.consider = :consider', { consider: true })
      .getRawMany();
  }

  /**
   * Get all units for a person
   */
  private async getUnitsForPerson(personId: number): Promise<Unit[]> {
    return this.unitRepository
      .createQueryBuilder('unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletInfo')
      .where('booklet.personid = :personId', { personId })
      .getMany();
  }

  /**
   * Create a connector string for a person and booklet
   */
  private createConnector(person: Persons, bookletId: string): string {
    return `${person.login}@${person.code}@${bookletId}`;
  }

  /**
   * Cache a response for a specific workspace, test person, and unit
   */
  private async cacheResponse(workspaceId: number, connector: string, unitId: string): Promise<void> {
    const cacheKey = this.cacheService.generateUnitResponseCacheKey(workspaceId, connector, unitId);

    // Check if already in cache
    const exists = await this.cacheService.exists(cacheKey);
    if (exists) {
      this.logger.debug(`Response already in cache: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`);
      return;
    }

    // Fetch and cache the response
    try {
      const response = await this.workspaceTestResultsService.findUnitResponse(workspaceId, connector, unitId);
      await this.cacheService.set(cacheKey, response);
      this.logger.debug(`Cached response: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`);
    } catch (error) {
      this.logger.error(`Error fetching response for caching: ${error.message}`, error.stack);
      throw error;
    }
  }
}
