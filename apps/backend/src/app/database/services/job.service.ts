import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job } from '../entities/job.entity';

@Injectable()
export class JobService {
  private readonly logger = new Logger(JobService.name);

  constructor(
    @InjectRepository(Job)
    private jobRepository: Repository<Job>
  ) {}

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

  async updateJob(jobId: number, updates: Partial<Job>): Promise<Job> {
    const job = await this.getJob(jobId);
    Object.assign(job, updates);
    return this.jobRepository.save(job);
  }

  async cancelJob(jobId: number): Promise<{ success: boolean; message: string }> {
    try {
      const job = await this.getJob(jobId);

      if (job.status !== 'pending' && job.status !== 'processing') {
        return {
          success: false,
          message: `Job with ID ${jobId} cannot be cancelled because it is already ${job.status}`
        };
      }

      job.status = 'cancelled';
      await this.jobRepository.save(job);
      this.logger.log(`Job ${jobId} has been cancelled`);

      return { success: true, message: `Job ${jobId} has been cancelled successfully` };
    } catch (error) {
      this.logger.error(`Error cancelling job: ${error.message}`, error.stack);
      return { success: false, message: `Error cancelling job: ${error.message}` };
    }
  }

  async deleteJob(jobId: number): Promise<{ success: boolean; message: string }> {
    try {
      const job = await this.getJob(jobId);
      if (job.status === 'pending' || job.status === 'processing') {
        return {
          success: false,
          message: `Job with ID ${jobId} cannot be deleted because it is currently ${job.status}`
        };
      }
      await this.jobRepository.remove(job);
      this.logger.log(`Job ${jobId} has been deleted`);

      return { success: true, message: `Job ${jobId} has been deleted successfully` };
    } catch (error) {
      this.logger.error(`Error deleting job: ${error.message}`, error.stack);
      return { success: false, message: `Error deleting job: ${error.message}` };
    }
  }

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
