import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { SocketGateway } from '../socket/socket.gateway';
import { MONTERIA_BARRIOS } from './monteria-barrios';

@Injectable()
export class ZonesService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
    private socketGateway: SocketGateway,
  ) {}

  async findAll() {
    return this.cache.getOrSet('zones_all', async () => {
      return this.prisma.deliveryZone.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    }, 600_000); // 10 min
  }

  async findAllGrouped() {
    return this.cache.getOrSet('zones_grouped', async () => {
      const zones = await this.prisma.deliveryZone.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
      const groups: Record<string, any[]> = {};
      for (const zone of zones) {
        const group = zone.zoneGroup || 'General';
        if (!groups[group]) groups[group] = [];
        groups[group].push(zone);
      }
      return groups;
    }, 600_000); // 10 min
  }

  async findAllWithOrders() {
    return this.prisma.deliveryZone.findMany({
      where: { active: true },
      include: { orders: { where: { status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 5 } },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const zone = await this.prisma.deliveryZone.findUnique({ where: { id } });
    if (!zone) throw new NotFoundException('Zona no encontrada');
    return zone;
  }

  async getGroups() {
    return this.cache.getOrSet('zones_groups', async () => {
      let groups: string[] = [];
      const setting = await this.prisma.appSetting.findUnique({ where: { key: 'delivery_zone_groups' } });
      if (setting) {
        try {
          groups = JSON.parse(setting.value);
        } catch (e) {
          // Ignore
        }
      } else {
        groups = ['Centro', 'Norte', 'Sur', 'Oriente', 'Occidente', 'Periferia', 'General'];
        await this.prisma.appSetting.upsert({
          where: { key: 'delivery_zone_groups' },
          create: { key: 'delivery_zone_groups', value: JSON.stringify(groups) },
          update: { value: JSON.stringify(groups) },
        });
      }

      // Merge with actual zoneGroups present in active delivery zones
      const activeZones = await this.prisma.deliveryZone.findMany({ where: { active: true } });
      const dbGroups = activeZones.map(z => z.zoneGroup || 'General');
      const merged = [...new Set([...groups, ...dbGroups])];
      return merged.sort();
    }, 600_000); // 10 min
  }

  async createGroup(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('El nombre de la zona no puede estar vacío');
    const groups = await this.getGroups();
    if (groups.includes(trimmed)) {
      return groups;
    }
    const newGroups = [...groups, trimmed];
    await this.prisma.appSetting.upsert({
      where: { key: 'delivery_zone_groups' },
      create: { key: 'delivery_zone_groups', value: JSON.stringify(newGroups) },
      update: { value: JSON.stringify(newGroups) },
    });
    this.invalidateCache();
    return newGroups.sort();
  }

  async updateGroup(oldName: string, newName: string) {
    const trimmedOld = oldName.trim();
    const trimmedNew = newName.trim();
    if (!trimmedNew) throw new Error('El nuevo nombre de la zona no puede estar vacío');
    
    const groups = await this.getGroups();
    const index = groups.indexOf(trimmedOld);
    if (index !== -1) {
      groups[index] = trimmedNew;
      const newGroups = [...new Set(groups)];
      await this.prisma.appSetting.upsert({
        where: { key: 'delivery_zone_groups' },
        create: { key: 'delivery_zone_groups', value: JSON.stringify(newGroups) },
        update: { value: JSON.stringify(newGroups) },
      });
    }
    
    // Also update all DeliveryZone records in the DB
    await this.prisma.deliveryZone.updateMany({
      where: { zoneGroup: trimmedOld },
      data: { zoneGroup: trimmedNew },
    });
    
    this.invalidateCache();
    return this.getGroups();
  }

  async deleteGroup(name: string) {
    const trimmed = name.trim();
    const groups = await this.getGroups();
    const newGroups = groups.filter(g => g !== trimmed);
    await this.prisma.appSetting.upsert({
      where: { key: 'delivery_zone_groups' },
      create: { key: 'delivery_zone_groups', value: JSON.stringify(newGroups) },
      update: { value: JSON.stringify(newGroups) },
    });
    
    // Deactivate all DeliveryZone records in this zone group (barrios)
    await this.prisma.deliveryZone.updateMany({
      where: { zoneGroup: trimmed },
      data: { active: false },
    });
    
    this.invalidateCache();
    return newGroups.sort();
  }

  private invalidateCache() {
    this.cache.invalidateByPrefix('zones_');
    this.socketGateway.server.emit('zonesChanged');
  }

  async create(data: { name: string; rate: number; zoneGroup?: string; km?: number; latitude?: number; longitude?: number }) {
    const result = await this.prisma.deliveryZone.create({
      data: {
        name: data.name,
        rate: data.rate,
        zoneGroup: data.zoneGroup || 'General',
        km: data.km,
        latitude: data.latitude,
        longitude: data.longitude,
      },
    });
    this.invalidateCache();
    return result;
  }

  async update(id: string, data: { name?: string; rate?: number; active?: boolean; zoneGroup?: string; km?: number; latitude?: number; longitude?: number }) {
    await this.findOne(id);
    const result = await this.prisma.deliveryZone.update({ where: { id }, data });
    this.invalidateCache();
    return result;
  }

  async remove(id: string) {
    await this.findOne(id);
    const result = await this.prisma.deliveryZone.update({ where: { id }, data: { active: false } });
    this.invalidateCache();
    return result;
  }

  async seedMonteriaBarrios() {
    let created = 0;
    let updated = 0;
    for (const barrio of MONTERIA_BARRIOS) {
      const existing = await this.prisma.deliveryZone.findFirst({
        where: { name: barrio.name, zoneGroup: barrio.zoneGroup },
      });
      if (existing) {
        await this.prisma.deliveryZone.update({
          where: { id: existing.id },
          data: { rate: barrio.rate, active: true },
        });
        updated++;
      } else {
        await this.prisma.deliveryZone.create({ data: barrio });
        created++;
      }
    }
    this.invalidateCache();
    return { created, updated, total: MONTERIA_BARRIOS.length };
  }

  async suggestByName(name: string) {
    if (!name) return null;
    const normalized = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const zones = await this.findAll(); // uses cache!
    const match = zones.find(z => {
      const zn = z.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return zn.includes(normalized) || normalized.includes(zn);
    });
    return match ? { id: match.id, name: match.name, rate: match.rate, zoneGroup: match.zoneGroup } : null;
  }

  async clearAll() {
    // Set zoneId to null on all orders
    await this.prisma.order.updateMany({
      data: { zoneId: null },
    });
    // Delete all delivery zones
    const result = await this.prisma.deliveryZone.deleteMany({});
    this.invalidateCache();
    return { count: result.count };
  }
}
