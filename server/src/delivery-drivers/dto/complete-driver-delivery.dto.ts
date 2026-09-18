import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteDriverDeliveryDto {
  @IsIn(['CASH', 'TRANSFER', 'NEQUI', 'BANCOLOMBIA', 'DAVIPLATA'])
  method: 'CASH' | 'TRANSFER' | 'NEQUI' | 'BANCOLOMBIA' | 'DAVIPLATA';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reference?: string;
}
