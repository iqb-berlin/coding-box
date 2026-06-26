import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';

import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth/service/auth.service';
import { CreateUserDto } from '../../../../api-dto/user/create-user-dto';
import { AuthDataDto } from '../../../../api-dto/auth-data-dto';
import { UsersService } from './database/services/users';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { TestcenterService } from './database/services/test-results';
import { WorkspaceUsersService } from './database/services/workspace';

type AuthenticatedRequest = Request & {
  user?: {
    identity?: string;
  };
};

@Controller()
export class AppController {
  constructor(private authService:AuthService,
              private usersService: UsersService,
              private testCenterService: TestcenterService,
              private workspaceUsersService: WorkspaceUsersService) {}

  @Get('auth-data')
  @UseGuards(JwtAuthGuard)
  @ApiOkResponse({ description: 'User auth data successfully retrieved.' })
  @ApiTags('auth')
  async getUserAuthData(
    @Query('identity') identity: string,
      @Req() req: AuthenticatedRequest
  ): Promise<AuthDataDto> {
    if (typeof identity !== 'string') {
      throw new BadRequestException('identity query parameter is required');
    }

    const requestedIdentity = identity.trim();

    if (!requestedIdentity) {
      throw new BadRequestException('identity query parameter is required');
    }

    this.assertTokenMatchesRequestedIdentity(requestedIdentity, req.user?.identity);

    const user = await this.usersService.findUserByIdentity(requestedIdentity);
    if (!user) {
      throw new NotFoundException(`User with identity ${requestedIdentity} not found`);
    }

    const workspaces = await this.workspaceUsersService.findAllUserWorkspaces(requestedIdentity);
    return <AuthDataDto><unknown>{
      userId: user.id,
      userName: user.username,
      isAdmin: user.isAdmin,
      workspaces: workspaces
    };
  }

  private assertTokenMatchesRequestedIdentity(requestedIdentity: string, tokenIdentity?: string): void {
    if (!tokenIdentity || tokenIdentity !== requestedIdentity) {
      throw new ForbiddenException('Requested identity does not match the authenticated user');
    }
  }

  @Post('keycloak-login')
  @ApiTags('auth')
  @ApiOkResponse({ description: 'Keycloak login successful.' })
  async keycloakLogin(@Body() user: CreateUserDto) {
    const token = await this.authService.keycloakLogin(user);
    return `"${token}"`;
  }

  @Post('tc_authentication')
  async authenticateTestCenter(
    @Body() credentials: { username: string, password: string, server: string, url: string }
  ): Promise<Record<string, unknown>> {
    return this.testCenterService.authenticate(credentials);
  }
}
