import { Injectable, Logger } from '@nestjs/common';

/**
 * Servicio de caché en memoria ultraliviano.
 * Almacena resultados de consultas frecuentes para evitar
 * golpear la base de datos en cada petición.
 *
 * - TTL configurable por clave
 * - Invalidación manual por clave o patrón
 * - Sin dependencias externas (no necesita Redis)
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private store = new Map<string, { data: any; expiresAt: number }>();

  /** Default TTL: 60 seconds */
  private readonly DEFAULT_TTL_MS = 60_000;

  /**
   * Get a cached value or execute the factory function to populate it.
   * @param key Unique cache key
   * @param factory Async function that returns the data to cache
   * @param ttlMs Time to live in milliseconds (default: 60s)
   */
  async getOrSet<T>(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.store.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T;
    }

    const data = await factory();
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.DEFAULT_TTL_MS),
    });
    return data;
  }

  /** Get a cached value (returns undefined if not found or expired) */
  get<T>(key: string): T | undefined {
    const cached = this.store.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T;
    }
    if (cached) {
      this.store.delete(key);
    }
    return undefined;
  }

  /** Set a value in cache */
  set(key: string, data: any, ttlMs?: number): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.DEFAULT_TTL_MS),
    });
  }

  /** Invalidate a specific key */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Invalidate all keys that start with a given prefix */
  invalidateByPrefix(prefix: string): void {
    let count = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        count++;
      }
    }
    if (count > 0) {
      this.logger.debug(`Cache invalidado: ${count} claves con prefijo "${prefix}"`);
    }
  }

  /** Clear the entire cache */
  clear(): void {
    this.store.clear();
    this.logger.debug('Cache completamente limpiado');
  }

  /** Get cache stats */
  stats() {
    let active = 0;
    let expired = 0;
    const now = Date.now();
    for (const entry of this.store.values()) {
      if (entry.expiresAt > now) active++;
      else expired++;
    }
    return { total: this.store.size, active, expired };
  }
}
