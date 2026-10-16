import { PassportModule } from '@nestjs/passport';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './service/auth.service';
import { UserModule } from '../user/user.module';
import { JwtStrategy } from './jwt.strategy';
import { KeycloakJwksService } from './keycloak-jwks.service';
import { JournalEntry } from '../database/entities/journal-entry.entity';
import { JournalService } from '../database/services/shared/journal.service';

@Module({
  imports: [
    PassportModule,
    UserModule,
    HttpModule,
    TypeOrmModule.forFeature([JournalEntry]),
    JwtModule.registerAsync({
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '30m' }
      }),
      inject: [ConfigService]
    })
  ],
  providers: [AuthService, JwtStrategy, KeycloakJwksService, JournalService],
  exports: [AuthService, UserModule]
})
export class AuthModule { }
