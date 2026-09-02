import { Module } from '@nestjs/common';
import { GeocodingController } from './geocoding.controller';
import { ZonesModule } from '../zones/zones.module';

@Module({
  imports: [ZonesModule],
  controllers: [GeocodingController],
})
export class GeocodingModule {}
