import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'hugo' })
    username!: string;

  @ApiPropertyOptional({ type: Boolean, example: false })
    isAdmin = false;

  @ApiProperty()
    email?: string;

  @ApiProperty()
    lastName?: string;

  @ApiProperty()
    firstName?: string;

  @ApiProperty()
    issuer?: string;

  @ApiProperty()
    identity?: string;
}
