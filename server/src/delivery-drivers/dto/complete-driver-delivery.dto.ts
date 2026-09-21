import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CompleteDriverDeliveryDto {
  @IsIn(['CASH', 'TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA', 'MIXED'])
  method: 'CASH' | 'TRANSFER' | 'NEQUI' | 'BANCOLOMBIA' | 'DAVIPLATA' | 'MIXED';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'El valor recibido en efectivo debe ser un número válido.' })
  @Min(0, { message: 'El valor recibido en efectivo no puede ser negativo.' })
  cashAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'El valor recibido por transferencia debe ser un número válido.' })
  @Min(0, { message: 'El valor recibido por transferencia no puede ser negativo.' })
  transferAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reference?: string;
}
