import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WsgCodingJobController } from './coding-job.controller';
import { CodingJobService } from '../../database/services/coding-job.service';
import { CodingJob } from '../../database/entities/coding-job.entity';
import { CodingJobCoder } from '../../database/entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../database/entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../../database/entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../../database/entities/coding-job-unit.entity';
import { JobDefinition } from '../../database/entities/job-definition.entity';
import { VariableBundle } from '../../database/entities/variable-bundle.entity';
import { ResponseEntity } from '../../database/entities/response.entity';
import { Unit } from '../../database/entities/unit.entity';
import FileUpload from '../../database/entities/file_upload.entity';
import { Setting } from '../../database/entities/setting.entity';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { CacheModule } from '../../cache/cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CodingJob,
      CodingJobCoder,
      CodingJobVariable,
      CodingJobVariableBundle,
      CodingJobUnit,
      JobDefinition,
      VariableBundle,
      ResponseEntity,
      Unit,
      FileUpload,
      Setting
    ]),
    AuthModule,
    DatabaseModule,
    CacheModule
  ],
  controllers: [WsgCodingJobController],
  providers: [CodingJobService],
  exports: [CodingJobService]
})
export class WsgCodingJobModule {}
