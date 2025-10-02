import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VariableBundle } from '../../database/entities/variable-bundle.entity';
import { VariableBundleService } from '../../database/services/variable-bundle.service';
import { VariableBundleController } from './variable-bundle.controller';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([VariableBundle]),
    AuthModule,
    DatabaseModule
  ],
  controllers: [VariableBundleController],
  providers: [VariableBundleService],
  exports: [VariableBundleService]
})
export class VariableBundleModule {}
