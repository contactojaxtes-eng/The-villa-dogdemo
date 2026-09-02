import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDriverDto {
  @ApiProperty({ description: 'Nombre del domiciliario', example: 'Juan Pérez' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  name: string;

  @ApiProperty({ description: 'Teléfono del domiciliario', example: '3001234567' })
  @IsString()
  @IsNotEmpty({ message: 'El teléfono es obligatorio.' })
  phone: string;

  @ApiPropertyOptional({ description: 'Estado activo', default: true })
  @IsBoolean()
  @IsOptional()
  active?: boolean;
}
