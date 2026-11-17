import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Setting } from '../database/entities/setting.entity';
import { TestcenterInstancesService } from './testcenter-instances.service';

@Module({
  imports: [ConfigModule, HttpModule, TypeOrmModule.forFeature([Setting])],
  providers: [TestcenterInstancesService],
  exports: [TestcenterInstancesService]
})
export class TestcenterInstancesModule {}
