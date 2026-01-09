import { PassportModule } from '@nestjs/passport';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
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
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || configService.get<string>('SECRET') || 'default-secret',
        signOptions: {
          expiresIn: '1d'
        }
      }),
      inject: [ConfigService]
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, OAuth2ClientCredentialsService, KeycloakAuthService, JwtStrategy],
  exports: [AuthService, OAuth2ClientCredentialsService, KeycloakAuthService]
})
export class AuthModule { }
