import { PassportModule } from '@nestjs/passport';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './service/auth.service';
import { jwtConstants } from './auth.constants';
import { JwtStrategy } from './jwt.strategy';
import { DatabaseModule } from '../database/database.module';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    PassportModule,
    DatabaseModule,
    HttpModule,
    JwtModule.register({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '1d' }
    })
  ],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService]
})
export class AuthModule { }
