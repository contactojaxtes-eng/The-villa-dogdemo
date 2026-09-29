import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateItemDto {
  @ApiProperty({ description: 'Nombre del producto', example: 'Hamburguesa Doble Queso' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre del producto es requerido.' })
  name: string;

  @ApiPropertyOptional({ description: 'Código único del producto', example: 'HAMB01' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ description: 'Descripción detallada del producto' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Precio de venta del producto', example: 25000 })
  @Type(() => Number)
  @IsNumber({}, { message: 'El precio debe ser un número válido.' })
  @Min(0, { message: 'El precio no puede ser negativo.' })
  price: number;

  @ApiPropertyOptional({ description: 'URL o imagen Base64 del producto' })
  @IsString()
  @IsOptional()
  image?: string;

  @ApiProperty({ description: 'ID de la categoría a la que pertenece', example: 'cat-uuid' })
  @IsString()
  @IsNotEmpty({ message: 'La categoría es requerida.' })
  categoryId: string;

  @ApiPropertyOptional({ description: 'Estado de disponibilidad del producto', default: true })
  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Disponible para domicilios y carta de WhatsApp', default: true })
  @IsBoolean()
  @IsOptional()
  availableForDelivery?: boolean;

  @ApiPropertyOptional({ description: 'Tipo de producto: NORMAL, COMBO, ADICION', default: 'NORMAL' })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiPropertyOptional({ description: 'Lista de items que componen el combo' })
  @IsOptional()
  comboItems?: any;

  @ApiPropertyOptional({ description: 'Tiempo de preparación en minutos', default: 10 })
  @Type(() => Number)
  @IsNumber({}, { message: 'El tiempo de preparación debe ser un número válido.' })
  @Min(0, { message: 'El tiempo de preparación no puede ser negativo.' })
  @IsOptional()
  prepTime?: number;
}
