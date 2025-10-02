import { PassportModule } from '@nestjs/passport';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './service/auth.service';
import { OAuth2ClientCredentialsService } from './service/oauth2-client-credentials.service';
import { KeycloakAuthService } from './service/keycloak-auth.service';
import { AuthController } from './auth.controller';
import { DatabaseModule } from '../database/database.module';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    DatabaseModule,
    HttpModule,
    JwtModule.registerAsync({
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '365d' }
      }),
      inject: [ConfigService]
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, OAuth2ClientCredentialsService, KeycloakAuthService, JwtStrategy],
  exports: [AuthService, OAuth2ClientCredentialsService, KeycloakAuthService]
})
export class AuthModule { }
