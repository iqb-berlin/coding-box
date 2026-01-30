import { PassportModule } from '@nestjs/passport';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthService } from './service/auth.service';
import { OAuth2ClientCredentialsService } from './service/oauth2-client-credentials.service';
import { KeycloakAuthService } from './service/keycloak-auth.service';
import { AuthController } from './auth.controller';
import { DatabaseModule } from '../database/database.module';
import { UserModule } from '../user/user.module';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    DatabaseModule,
    HttpModule,
    UserModule,
    HttpModule
  ],
  controllers: [AuthController],
  providers: [AuthService, OAuth2ClientCredentialsService, KeycloakAuthService, JwtStrategy],
  exports: [AuthService, OAuth2ClientCredentialsService, KeycloakAuthService]
})
export class AuthModule { }
