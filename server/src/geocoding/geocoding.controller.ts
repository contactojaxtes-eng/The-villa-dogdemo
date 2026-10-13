import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZonesService } from '../zones/zones.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Geocoding')
@Controller('geocoding')
export class GeocodingController {
  constructor(private zonesService: ZonesService) {}

  @Get('search')
  @UseGuards(JwtAuthGuard)
  async search(@Query('q') query: string, @Request() req?: any) {
    if (!query || query.length < 3) return [];
    const siteId = req?.user?.siteId;

    const encoded = encodeURIComponent(`${query}, Montería, Córdoba, Colombia`);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=8&countrycodes=co&addressdetails=1`;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'THE VILLA DOG-Domicilios/1.0' },
      });
      const data = await res.json();
      const results = await Promise.all(
        (data || []).map(async (item: any) => {
          const addressDetails = item.address || {};
          
          // Prioritize specific neighborhood candidates and strictly exclude 'comuna'
          let neighbourhood = '';
          const candidates = [
            addressDetails.neighbourhood,
            addressDetails.quarter,
            addressDetails.suburb,
            addressDetails.village,
            addressDetails.hamlet,
          ].filter(cand => cand && typeof cand === 'string' && !cand.toLowerCase().includes('comuna'));
          
          if (candidates.length > 0) {
            neighbourhood = candidates[0];
          }

          // Clean display_name and address by filtering out 'comuna' parts
          const parts = (item.display_name || '').split(',');
          const cleanParts = parts
            .map((p: string) => p.trim())
            .filter((p: string) => p && !p.toLowerCase().includes('comuna'));
            
          const cleanDisplayName = cleanParts.join(', ');
          const cleanAddress = cleanParts.slice(0, 3).join(', ');

          // Una excepción exacta configurada con tarifa $0 sí prevalece sobre el
          // barrio general. Las coincidencias normales se resuelven primero por
          // el barrio de Nominatim para que palabras amplias como "Centro" no
          // ganen solo por aparecer en el nombre de un establecimiento.
          let suggestedZone: any = await this.zonesService.suggestExactFreePlace(query, siteId);
          if (!suggestedZone && neighbourhood) {
            suggestedZone = await this.zonesService.suggestByName(neighbourhood, siteId);
          }
          if (!suggestedZone) {
            for (const part of cleanParts) {
              suggestedZone = await this.zonesService.suggestByName(part, siteId);
              if (suggestedZone) break;
            }
          }
          if (!suggestedZone) {
            suggestedZone = await this.zonesService.suggestByName(query, siteId);
          }
          // If a zone is matched, synchronize the neighbourhood name with the official zone name
          if (suggestedZone) {
            neighbourhood = suggestedZone.name;
          }
          return {
            displayName: cleanDisplayName,
            address: cleanAddress || cleanDisplayName,
            latitude: parseFloat(item.lat),
            longitude: parseFloat(item.lon),
            neighbourhood,
            city: addressDetails.city || addressDetails.town || 'Montería',
            suggestedZone,
          };
        }),
      );
      return results;
    } catch {
      return [];
    }
  }
}
