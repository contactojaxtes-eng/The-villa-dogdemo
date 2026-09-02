import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZonesService } from '../zones/zones.service';

@ApiTags('Geocoding')
@Controller('geocoding')
export class GeocodingController {
  constructor(private zonesService: ZonesService) {}

  @Get('search')
  async search(@Query('q') query: string) {
    if (!query || query.length < 3) return [];

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

          // Resolve suggested zone: try by extracted neighbourhood first, then by clean parts, then by overall query
          let suggestedZone: any = null;
          if (neighbourhood) {
            suggestedZone = await this.zonesService.suggestByName(neighbourhood);
          }
          if (!suggestedZone) {
            for (const part of cleanParts) {
              suggestedZone = await this.zonesService.suggestByName(part);
              if (suggestedZone) break;
            }
          }
          if (!suggestedZone) {
            suggestedZone = await this.zonesService.suggestByName(query);
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
