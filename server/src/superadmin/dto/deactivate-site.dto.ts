import { Equals, IsBoolean, IsString, Length } from 'class-validator';

export class DeactivateSiteDto {
  @IsString()
  @Length(2, 40)
  confirmationCode: string;

  @IsBoolean()
  @Equals(true, {
    message: 'Debes confirmar que deseas pausar la sede secundaria',
  })
  acknowledgePause: boolean;
}
