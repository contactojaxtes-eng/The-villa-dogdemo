import { Equals, IsBoolean, IsString, Length } from 'class-validator';

export class ActivateSiteDto {
  @IsString()
  @Length(2, 40)
  confirmationCode: string;

  @IsBoolean()
  @Equals(true, {
    message: 'Debes confirmar que verificaste el aislamiento de la sede',
  })
  acknowledgeIsolation: boolean;
}
