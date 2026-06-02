import { PassportModule } from '@nestjs/passport';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './service/auth.service';
import { OAuth2ClientCredentialsService } from './service/oauth2-client-credentials.service';
import { OidcAuthService } from './service/oidc-auth.service';
import { AuthController } from './auth.controller';
import { DatabaseModule } from '../database/database.module';
import { UserModule } from '../user/user.module';
import { CacheModule } from '../cache/cache.module';
import { JwtStrategy } from './jwt.strategy';
import { WorkspaceTokenStrategy } from './workspace-token.strategy';

@Module({
  imports: [
    PassportModule,
    DatabaseModule,
    HttpModule,
    UserModule,
    CacheModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET')
      })
    })
  ],
  controllers: [AuthController],
  providers: [AuthService, OAuth2ClientCredentialsService, OidcAuthService, JwtStrategy, WorkspaceTokenStrategy],
  exports: [AuthService, OAuth2ClientCredentialsService, OidcAuthService, UserModule]
})
export class AuthModule { }
