import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { UserModule } from './user.module';
import { KeycloakUserSyncService } from './keycloak-user-sync.service';

@Module({
  imports: [HttpModule, UserModule],
  providers: [KeycloakUserSyncService]
})
export class KeycloakUserSyncModule {}
