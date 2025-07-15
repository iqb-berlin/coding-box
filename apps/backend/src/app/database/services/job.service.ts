import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from '../entities/job.entity';

/**
 * Service for managing jobs
 */
@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    @InjectRepository(Job)
    private jobRepository: Repository<Job>
  ) {}

  /**
   * Get a job by ID
   * @param jobId The ID of the job
   * @param workspaceId Optional workspace ID to filter by
   * @returns The job
   * @throws NotFoundException if the job is not found
   */
  async getJob(jobId: number, workspaceId?: number): Promise<Job> {
    const whereClause: { id: number; workspace_id?: number } = { id: jobId };

    if (workspaceId !== undefined) {
      whereClause.workspace_id = workspaceId;
    }

    const job = await this.jobRepository.findOne({ where: whereClause });
    if (!job) {
      if (workspaceId !== undefined) {
        throw new NotFoundException(`Job with ID ${jobId} not found in workspace ${workspaceId}`);
      } else {
        throw new NotFoundException(`Job with ID ${jobId} not found`);
      }
    }
    return job;
  }

  /**
   * Get all jobs for a workspace
   * @param workspaceId The ID of the workspace
   * @param type Optional job type to filter by
   * @returns Array of jobs
   */
  async getJobs(workspaceId: number, type?: string): Promise<Job[]> {
    const whereClause: { workspace_id: number; type?: string } = { workspace_id: workspaceId };

    if (type) {
      whereClause.type = type;
    }

    return this.jobRepository.find({
      where: whereClause,
      order: { created_at: 'DESC' }
    });
  }

  /**
   * Update a job
   * @param jobId The ID of the job
   * @param updates The updates to apply
   * @returns The updated job
   * @throws NotFoundException if the job is not found
   */
  async updateJob(jobId: number, updates: Partial<Job>): Promise<Job> {
    const job = await this.getJob(jobId);

    // Apply updates
    Object.assign(job, updates);

    // Save the job
    return this.jobRepository.save(job);
  }

  /**
   * Cancel a job
   * @param jobId The ID of the job
   * @returns Object with success flag and message
   */
  async cancelJob(jobId: number): Promise<{ success: boolean; message: string }> {
    try {
      const job = await this.getJob(jobId);

      // Only pending or processing jobs can be cancelled
      if (job.status !== 'pending' && job.status !== 'processing') {
        return {
          success: false,
          message: `Job with ID ${jobId} cannot be cancelled because it is already ${job.status}`
        };
      }

      // Update job status to cancelled
      job.status = 'cancelled';
      await this.jobRepository.save(job);
      this.logger.log(`Job ${jobId} has been cancelled`);

      return { success: true, message: `Job ${jobId} has been cancelled successfully` };
    } catch (error) {
      this.logger.error(`Error cancelling job: ${error.message}`, error.stack);
      return { success: false, message: `Error cancelling job: ${error.message}` };
    }
  }

  /**
   * Check if a job has been cancelled
   * @param jobId The ID of the job
   * @returns True if the job has been cancelled, false otherwise
   */
  async isJobCancelled(jobId: number): Promise<boolean> {
    try {
      const job = await this.getJob(jobId);
      return job.status === 'cancelled';
    } catch (error) {
      this.logger.error(`Error checking job cancellation: ${error.message}`, error.stack);
      return false; // Assume not cancelled on error
    }
  }
}
