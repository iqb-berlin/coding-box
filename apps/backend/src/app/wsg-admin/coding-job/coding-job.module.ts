import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WsgCodingJobController } from './coding-job.controller';
import { CodingJobService } from '../../database/services/coding-job.service';
import { CodingJob } from '../../database/entities/coding-job.entity';
import { CodingJobCoder } from '../../database/entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../database/entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../../database/entities/coding-job-variable-bundle.entity';
import { VariableBundle } from '../../database/entities/variable-bundle.entity';
import { ResponseEntity } from '../../database/entities/response.entity';
import { Unit } from '../../database/entities/unit.entity';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CodingJob,
      CodingJobCoder,
      CodingJobVariable,
      CodingJobVariableBundle,
      VariableBundle,
      ResponseEntity,
      Unit
    ]),
    AuthModule
  ],
  controllers: [WsgCodingJobController],
  providers: [CodingJobService],
  exports: [CodingJobService]
})
export class WsgCodingJobModule {}
