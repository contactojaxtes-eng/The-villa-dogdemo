import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }) => String(value ?? '').trim();
const envKey = ({ value }: { value: unknown }) =>
  String(value ?? '')
    .trim()
    .toUpperCase();

// Las sedes secundarias solo pueden referenciar secretos creados
// específicamente para WhatsApp. Esto impide que un error de configuración
// reutilice DATABASE_URL, JWT_SECRET u otra credencial interna del servidor.
export const WHATSAPP_ACCESS_TOKEN_ENV_KEY_PATTERN =
  /^(?=[A-Z0-9_]{3,128}$)(?=.*(?:^|_)WHATSAPP(?:_|$))(?=.*(?:^|_)ACCESS_TOKEN(?:_|$))[A-Z][A-Z0-9_]*$/;
export const WHATSAPP_VERIFY_TOKEN_ENV_KEY_PATTERN =
  /^(?=[A-Z0-9_]{3,128}$)(?=.*(?:^|_)WHATSAPP(?:_|$))(?=.*(?:^|_)VERIFY_TOKEN(?:_|$))[A-Z][A-Z0-9_]*$/;

export class UpsertSiteWhatsAppAccountDto {
  @Transform(trim)
  @IsString()
  @Matches(/^\d{5,32}$/, {
    message: 'phoneNumberId debe contener únicamente números',
  })
  phoneNumberId: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Matches(/^\d{5,32}$/, {
    message: 'businessAccountId debe contener únicamente números',
  })
  businessAccountId?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(3, 40)
  displayPhoneNumber?: string;

  @Transform(envKey)
  @IsString()
  @Matches(WHATSAPP_ACCESS_TOKEN_ENV_KEY_PATTERN, {
    message:
      'accessTokenEnvKey debe ser una variable dedicada que incluya WHATSAPP y ACCESS_TOKEN',
  })
  accessTokenEnvKey: string;

  @Transform(envKey)
  @IsString()
  @Matches(WHATSAPP_VERIFY_TOKEN_ENV_KEY_PATTERN, {
    message:
      'verifyTokenEnvKey debe ser una variable dedicada que incluya WHATSAPP y VERIFY_TOKEN',
  })
  verifyTokenEnvKey: string;
}
