import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class ConfigureDriverAccessDto {
  @IsIn(['CREATE', 'LINK'])
  mode: 'CREATE' | 'LINK';

  @ValidateIf(input => input.mode === 'CREATE')
  @IsString()
  @MaxLength(120)
  login?: string;

  @ValidateIf(input => input.mode === 'CREATE')
  @IsString()
  @MinLength(4)
  @MaxLength(100)
  password?: string;

  @ValidateIf(input => input.mode === 'LINK')
  @IsUUID()
  userId?: string;
}
