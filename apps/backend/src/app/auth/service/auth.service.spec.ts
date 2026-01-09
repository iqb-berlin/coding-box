import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { AuthService } from './auth.service';
import { UsersService } from '../../database/services/users.service';
import { OAuth2ClientCredentialsService } from './oauth2-client-credentials.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: HttpService,
          useValue: createMock<HttpService>()
        },
        {
          provide: UsersService,
          useValue: createMock<UsersService>()
        },
        {
          provide: JwtService,
          useValue: createMock<JwtService>()
        },
        {
          provide: ConfigService,
          useValue: createMock<ConfigService>()
        },
        {
          provide: OAuth2ClientCredentialsService,
          useValue: createMock<OAuth2ClientCredentialsService>()
        }
      ]
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
