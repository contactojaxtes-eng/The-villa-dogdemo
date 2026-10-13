import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotIn,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class UpdateSiteMemberDto {
  @IsBoolean()
  active: boolean;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(2, 50)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'El rol de la sede tiene un formato inválido',
  })
  @IsNotIn(['SUPERADMIN'], {
    message: 'SUPERADMIN no se puede asignar como rol de sede',
  })
  role?: string;
}
