import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateSiteDto {
  @IsString()
  @Length(2, 80)
  name: string;

  @IsOptional()
  @IsString()
  @Length(2, 40)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'El código solo puede contener letras minúsculas, números y guiones',
  })
  code?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Length(2, 180)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(3, 30)
  phone?: string;
}
