import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { SocketGateway } from '../socket/socket.gateway';
import { MONTERIA_BARRIOS } from './monteria-barrios';
import { DEFAULT_SITE_ID } from '../common/multisite.constants';

@Injectable()
export class ZonesService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    private socketGateway: SocketGateway,
  ) {}

  async findAll(siteId = DEFAULT_SITE_ID) {
    return this.cache.getOrSet(`zones_${siteId}_all`, async () => {
      return this.prisma.deliveryZone.findMany({ where: { siteId, active: true }, orderBy: { name: 'asc' } });
    }, 600_000); // 10 min
  }

  async findAllGrouped(siteId = DEFAULT_SITE_ID) {
    return this.cache.getOrSet(`zones_${siteId}_grouped`, async () => {
      const zones = await this.prisma.deliveryZone.findMany({ where: { siteId, active: true }, orderBy: { name: 'asc' } });
      const groups: Record<string, any[]> = {};
      for (const zone of zones) {
        const group = zone.zoneGroup || 'General';
        if (!groups[group]) groups[group] = [];
        groups[group].push(zone);
      }
      return groups;
    }, 600_000); // 10 min
  }

  async findAllWithOrders(siteId = DEFAULT_SITE_ID) {
    return this.prisma.deliveryZone.findMany({
      where: { siteId, active: true },
      include: { orders: { where: { siteId, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 5 } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string, siteId = DEFAULT_SITE_ID) {
    const zone = await this.prisma.deliveryZone.findFirst({ where: { id, siteId } });
    if (!zone) throw new NotFoundException('Zona no encontrada');
    return zone;
  }

  async getGroups(siteId = DEFAULT_SITE_ID) {
    return this.cache.getOrSet(`zones_${siteId}_groups`, async () => {
      let groups: string[] = [];
      const setting = await this.prisma.siteSetting.findUnique({ where: { siteId_key: { siteId, key: 'delivery_zone_groups' } } });
      if (setting) {
        try {
          groups = JSON.parse(setting.value);
        } catch (e) {
          // Ignore
        }
      } else {
        groups = ['Centro', 'Norte', 'Sur', 'Oriente', 'Occidente', 'Periferia', 'General'];
        await this.prisma.siteSetting.upsert({
          where: { siteId_key: { siteId, key: 'delivery_zone_groups' } },
          create: { siteId, key: 'delivery_zone_groups', value: JSON.stringify(groups) },
          update: { value: JSON.stringify(groups) },
        });
      }

      // Merge with actual zoneGroups present in active delivery zones
      const activeZones = await this.prisma.deliveryZone.findMany({ where: { siteId, active: true } });
      const dbGroups = activeZones.map(z => z.zoneGroup || 'General');
      const merged = [...new Set([...groups, ...dbGroups])];
      return merged.sort();
    }, 600_000); // 10 min
  }

  async createGroup(name: string, siteId = DEFAULT_SITE_ID) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('El nombre de la zona no puede estar vacío');
    const groups = await this.getGroups(siteId);
    if (groups.includes(trimmed)) {
      return groups;
    }
    const newGroups = [...groups, trimmed];
    await this.prisma.siteSetting.upsert({
      where: { siteId_key: { siteId, key: 'delivery_zone_groups' } },
      create: { siteId, key: 'delivery_zone_groups', value: JSON.stringify(newGroups) },
      update: { value: JSON.stringify(newGroups) },
    });
    this.invalidateCache(siteId);
    return newGroups.sort();
  }

  async updateGroup(oldName: string, newName: string, siteId = DEFAULT_SITE_ID) {
    const trimmedOld = oldName.trim();
    const trimmedNew = newName.trim();
    if (!trimmedNew) throw new Error('El nuevo nombre de la zona no puede estar vacío');
    
    const groups = await this.getGroups(siteId);
    const index = groups.indexOf(trimmedOld);
    if (index !== -1) {
      groups[index] = trimmedNew;
      const newGroups = [...new Set(groups)];
      await this.prisma.siteSetting.upsert({
        where: { siteId_key: { siteId, key: 'delivery_zone_groups' } },
        create: { siteId, key: 'delivery_zone_groups', value: JSON.stringify(newGroups) },
        update: { value: JSON.stringify(newGroups) },
      });
    }
    
    // Also update all DeliveryZone records in the DB
    await this.prisma.deliveryZone.updateMany({
      where: { siteId, zoneGroup: trimmedOld },
      data: { zoneGroup: trimmedNew },
    });
    
    this.invalidateCache(siteId);
    return this.getGroups(siteId);
  }

  async deleteGroup(name: string, siteId = DEFAULT_SITE_ID) {
    const trimmed = name.trim();
    const groups = await this.getGroups(siteId);
    const newGroups = groups.filter(g => g !== trimmed);
    await this.prisma.siteSetting.upsert({
      where: { siteId_key: { siteId, key: 'delivery_zone_groups' } },
      create: { siteId, key: 'delivery_zone_groups', value: JSON.stringify(newGroups) },
      update: { value: JSON.stringify(newGroups) },
    });
    
    // Deactivate all DeliveryZone records in this zone group (barrios)
    await this.prisma.deliveryZone.updateMany({
      where: { siteId, zoneGroup: trimmed },
      data: { active: false },
    });
    
    this.invalidateCache(siteId);
    return newGroups.sort();
  }

  private invalidateCache(siteId: string) {
    this.cache.invalidateByPrefix(`zones_${siteId}_`);
    this.socketGateway.emitToSite(siteId, 'zonesChanged');
  }

  private normalizeZoneName(value: unknown): string {
    return String(value || '')
      .toLocaleLowerCase('es-CO')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private async assertUniqueActiveName(name: string, siteId: string, excludedId?: string) {
    const normalized = this.normalizeZoneName(name);
    if (!normalized) throw new BadRequestException('El nombre del barrio o lugar es obligatorio');
    const activeZones = await this.prisma.deliveryZone.findMany({
      where: { siteId, active: true, ...(excludedId ? { id: { not: excludedId } } : {}) },
      select: { id: true, name: true },
    });
    if (activeZones.some(zone => this.normalizeZoneName(zone.name) === normalized)) {
      throw new BadRequestException('Ya existe un barrio o lugar activo con ese nombre. Edita su tarifa en vez de duplicarlo.');
    }
  }

  async create(data: { name: string; rate: number; zoneGroup?: string; km?: number; latitude?: number; longitude?: number }, siteId = DEFAULT_SITE_ID) {
    const name = String(data.name || '').trim();
    const rate = Number(data.rate);
    if (!Number.isFinite(rate) || rate < 0) throw new BadRequestException('La tarifa debe ser un valor válido igual o mayor que $0');
    await this.assertUniqueActiveName(name, siteId);
    const result = await this.prisma.deliveryZone.create({
      data: {
        siteId,
        name,
        rate,
        zoneGroup: data.zoneGroup || 'General',
        km: data.km,
        latitude: data.latitude,
        longitude: data.longitude,
      },
    });
    this.invalidateCache(siteId);
    return result;
  }

  async update(id: string, data: { name?: string; rate?: number; active?: boolean; zoneGroup?: string; km?: number; latitude?: number; longitude?: number }, siteId = DEFAULT_SITE_ID) {
    const existing = await this.findOne(id, siteId);
    const updateData = { ...data };
    if (data.name !== undefined) {
      const name = String(data.name || '').trim();
      await this.assertUniqueActiveName(name, siteId, id);
      updateData.name = name;
    }
    if (data.rate !== undefined) {
      const rate = Number(data.rate);
      if (!Number.isFinite(rate) || rate < 0) throw new BadRequestException('La tarifa debe ser un valor válido igual o mayor que $0');
      updateData.rate = rate;
    }
    if (data.active === true && existing.active === false) {
      await this.assertUniqueActiveName(String(updateData.name ?? existing.name), siteId, id);
    }
    const result = await this.prisma.deliveryZone.update({ where: { id }, data: updateData });
    this.invalidateCache(siteId);
    return result;
  }

  async remove(id: string, siteId = DEFAULT_SITE_ID) {
    await this.findOne(id, siteId);
    const result = await this.prisma.deliveryZone.update({ where: { id }, data: { active: false } });
    this.invalidateCache(siteId);
    return result;
  }

  async seedMonteriaBarrios(siteId = DEFAULT_SITE_ID) {
    let created = 0;
    let updated = 0;
    for (const barrio of MONTERIA_BARRIOS) {
      const existing = await this.prisma.deliveryZone.findFirst({
        where: { siteId, name: barrio.name, zoneGroup: barrio.zoneGroup },
      });
      if (existing) {
        await this.prisma.deliveryZone.update({
          where: { id: existing.id },
          data: { rate: barrio.rate, active: true },
        });
        updated++;
      } else {
        await this.prisma.deliveryZone.create({ data: { ...barrio, siteId } });
        created++;
      }
    }
    this.invalidateCache(siteId);
    return { created, updated, total: MONTERIA_BARRIOS.length };
  }

  async suggestByName(name: string, siteId = DEFAULT_SITE_ID) {
    if (!name) return null;
    const normalized = this.normalizeZoneName(name);
    if (!normalized) return null;
    const zones = await this.findAll(siteId); // uses cache!
    const exact = zones.find(zone => this.normalizeZoneName(zone.name) === normalized);
    const match = exact || zones
      .filter(zone => {
        const zoneName = this.normalizeZoneName(zone.name);
        return zoneName.includes(normalized) || normalized.includes(zoneName);
      })
      .sort((left, right) => (
        this.normalizeZoneName(right.name).length - this.normalizeZoneName(left.name).length
      ))[0];
    return match ? { id: match.id, name: match.name, rate: match.rate, zoneGroup: match.zoneGroup } : null;
  }

  /**
   * Finds an explicitly configured free-delivery place mentioned in a search.
   *
   * This deliberately excludes paid zones. A broad paid zone such as "Centro"
   * must not override the neighbourhood returned by Nominatim merely because an
   * establishment name contains that word. Free places are explicit delivery
   * exceptions, so their complete configured name can safely take precedence.
   */
  async suggestExactFreePlace(name: string, siteId = DEFAULT_SITE_ID) {
    if (!name) return null;
    const normalized = this.normalizeZoneName(name);
    if (!normalized) return null;

    const paddedQuery = ` ${normalized} `;
    const zones = await this.findAll(siteId);
    const match = zones
      .filter(zone => Number(zone.rate) === 0)
      .filter(zone => {
        const zoneName = this.normalizeZoneName(zone.name);
        return Boolean(zoneName) && paddedQuery.includes(` ${zoneName} `);
      })
      .sort((left, right) => (
        this.normalizeZoneName(right.name).length - this.normalizeZoneName(left.name).length
      ))[0];

    return match ? { id: match.id, name: match.name, rate: match.rate, zoneGroup: match.zoneGroup } : null;
  }

  async clearAll(siteId = DEFAULT_SITE_ID) {
    // Set zoneId to null on all orders
    await this.prisma.order.updateMany({
      where: { siteId },
      data: { zoneId: null },
    });
    // Delete all delivery zones
    const result = await this.prisma.deliveryZone.deleteMany({ where: { siteId } });
    this.invalidateCache(siteId);
    return { count: result.count };
  }
}
