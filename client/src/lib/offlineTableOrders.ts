import type { OfflineTableOrderPayload } from '@/lib/tableTypes'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'
import { accessTokenMatchesSite, DEFAULT_SITE_ID } from '@/lib/multisite'

const DB_NAME = 'the-villa-dog-offline'
const STORE = 'table-orders'
const VERSION = 1

export type OfflineTableOrder = {
  siteId: string
  clientMutationId: string
  createdAt: string
  payload: OfflineTableOrderPayload
  status: 'PENDING' | 'SYNCING' | 'FAILED'
  error?: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'clientMutationId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveOfflineOrder(order: OfflineTableOrder) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ ...order, siteId: order.siteId || DEFAULT_SITE_ID })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function listOfflineOrders(siteId = DEFAULT_SITE_ID): Promise<OfflineTableOrder[]> {
  const db = await openDb()
  const rows = await new Promise<OfflineTableOrder[]>((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
  db.close()
  return rows
    .filter(row => (row.siteId || DEFAULT_SITE_ID) === siteId)
    .map(row => ({ ...row, siteId: row.siteId || DEFAULT_SITE_ID }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function deleteOfflineOrder(clientMutationId: string, siteId = DEFAULT_SITE_ID) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const getRequest = store.get(clientMutationId)
    getRequest.onsuccess = () => {
      const row = getRequest.result as OfflineTableOrder | undefined
      if (row && (row.siteId || DEFAULT_SITE_ID) === siteId) store.delete(clientMutationId)
    }
    getRequest.onerror = () => reject(getRequest.error)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

const syncingSites = new Set<string>()
export async function syncOfflineOrders(siteId = DEFAULT_SITE_ID): Promise<{ synced: number; failed: number }> {
  if (syncingSites.has(siteId) || !navigator.onLine || !accessTokenMatchesSite(api.getToken(), siteId)) {
    return { synced: 0, failed: 0 }
  }
  syncingSites.add(siteId)
  let synced = 0
  let failed = 0

  try {
    const rows = await listOfflineOrders(siteId)
    if (rows.length === 0) return { synced: 0, failed: 0 }

    for (const row of rows) {
      if (row.siteId !== siteId || !accessTokenMatchesSite(api.getToken(), row.siteId)) break
      try {
        if (row.payload.editOrderId) {
          await api.putForSite(`/tables/orders/${row.payload.editOrderId}`, row.siteId, { ...row.payload, offline: true })
        } else {
          await api.postForSite('/tables/orders', row.siteId, { ...row.payload, offline: true })
        }
        await deleteOfflineOrder(row.clientMutationId, row.siteId)
        synced++
      } catch (err: any) {
        if (err?.data?.code === 'SITE_CONTEXT_CHANGED') break
        if (err?.isNetworkError || !err?.status || err?.status === 0) {
          failed++
          break
        }
        await saveOfflineOrder({
          ...row,
          status: 'FAILED',
          error: err?.data?.message || err?.message || 'Error de sincronización',
        })
        failed++
      }
    }

    if (synced > 0) {
      alerts.success(
        '¡Pedidos Sincronizados!',
        `Se enviaron a cocina ${synced} pedido(s) tomado(s) sin conexión.`
      )
    }
  } catch (e) {
    console.error('[offlineSync] Error:', e)
  } finally {
    syncingSites.delete(siteId)
  }
  return { synced, failed }
}
