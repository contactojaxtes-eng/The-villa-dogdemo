import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'admin@thevilladog.local' })
  @IsString()
  @IsNotEmpty()
  email: string;
}
