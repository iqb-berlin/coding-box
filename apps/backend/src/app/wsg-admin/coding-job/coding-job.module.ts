import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WsgCodingJobController } from './coding-job.controller';
import { CodingJob } from '../../coding/entities/coding-job.entity';
import { CodingJobCoder } from '../../coding/entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../coding/entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../../coding/entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../../coding/entities/coding-job-unit.entity';
import { JobDefinition } from '../../coding/entities/job-definition.entity';
import { VariableBundle } from '../../coding/entities/variable-bundle.entity';
import { ResponseEntity } from '../../workspaces/entities/response.entity';
import { Unit } from '../../workspaces/entities/unit.entity';
import FileUpload from '../../workspaces/entities/file_upload.entity';
import { Setting } from '../../workspaces/entities/setting.entity';
import { AuthModule } from '../../auth/auth.module';
import { CacheModule } from '../../cache/cache.module';
import { CodingModule } from '../../coding/coding.module';

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
    CodingModule,
    CacheModule
  ],
  controllers: [WsgCodingJobController],
  providers: [],
  exports: [CodingModule]
})
export class WsgCodingJobModule {}
