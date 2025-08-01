import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CacheService } from './cache.service';
import Persons from '../database/entities/persons.entity';
import { WorkspaceTestResultsService } from '../database/services/workspace-test-results.service';

@Injectable()
export class BookletCacheSchedulerService {
  private readonly logger = new Logger(BookletCacheSchedulerService.name);
  private readonly BOOKLET_CACHE_TTL = 24 * 60 * 60; // 24 hours in seconds

  constructor(
    private readonly cacheService: CacheService,
    private readonly workspaceTestResultsService: WorkspaceTestResultsService,
    @InjectRepository(Persons)
    private readonly personsRepository: Repository<Persons>
  ) {}

  /**
   * Scheduled task to cache all test person booklets
   * Runs every night at 3:00 AM (after the response cache scheduler)
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cacheAllBooklets() {
    this.logger.log('Starting nightly task to cache all test person booklets');

    try {
      // Get all workspaces with persons
      const workspaces = await this.getWorkspacesWithPersons();

      for (const workspace of workspaces) {
        const workspaceId = workspace.workspace_id;
        this.logger.log(`Caching booklets for workspace ${workspaceId}`);

        // Get all test persons in this workspace
        const persons = await this.personsRepository.find({
          where: { workspace_id: workspaceId, consider: true }
        });

        for (const person of persons) {
          try {
            // Cache the booklet data for this person
            await this.cachePersonBooklets(person.id, workspaceId);
          } catch (error) {
            this.logger.error(`Error caching booklets for person ID ${person.id} in workspace ${workspaceId}: ${error.message}`, error.stack);
          }
        }
      }

      this.logger.log('Finished nightly caching of all test person booklets');
    } catch (error) {
      this.logger.error(`Error in cacheAllBooklets: ${error.message}`, error.stack);
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
   * Cache booklet data for a specific person
   */
  private async cachePersonBooklets(personId: number, workspaceId: number): Promise<void> {
    const cacheKey = this.generateBookletCacheKey(workspaceId, personId);

    // Check if already in cache
    const exists = await this.cacheService.exists(cacheKey);
    if (exists) {
      this.logger.debug(`Booklet data already in cache for person ID ${personId} in workspace ${workspaceId}`);
      return;
    }

    // Fetch and cache the booklet data
    try {
      const bookletData = await this.workspaceTestResultsService.findPersonTestResults(personId, workspaceId);
      await this.cacheService.set(cacheKey, bookletData, this.BOOKLET_CACHE_TTL);
      this.logger.debug(`Cached booklet data for person ID ${personId} in workspace ${workspaceId}`);
    } catch (error) {
      this.logger.error(`Error fetching booklet data for caching: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Generate a cache key for booklet data
   */
  private generateBookletCacheKey(workspaceId: number, personId: number): string {
    return `booklets:${workspaceId}:${personId}`;
  }
}
