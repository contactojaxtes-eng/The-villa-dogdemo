import type { OfflineTableOrderPayload } from '@/lib/tableTypes'
import { api } from '@/lib/api'
import { alerts } from '@/lib/alerts'

const DB_NAME = 'the-villa-dog-offline'
const STORE = 'table-orders'
const VERSION = 1

export type OfflineTableOrder = {
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
    tx.objectStore(STORE).put(order)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

export async function listOfflineOrders(): Promise<OfflineTableOrder[]> {
  const db = await openDb()
  const rows = await new Promise<OfflineTableOrder[]>((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
  db.close()
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function deleteOfflineOrder(clientMutationId: string) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(clientMutationId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

let isSyncing = false
export async function syncOfflineOrders(): Promise<{ synced: number; failed: number }> {
  if (isSyncing || !navigator.onLine) return { synced: 0, failed: 0 }
  isSyncing = true
  let synced = 0
  let failed = 0

  try {
    const rows = await listOfflineOrders()
    if (rows.length === 0) return { synced: 0, failed: 0 }

    for (const row of rows) {
      try {
        if (row.payload.editOrderId) {
          await api.put(`/tables/orders/${row.payload.editOrderId}`, { ...row.payload, offline: true })
        } else {
          await api.post('/tables/orders', { ...row.payload, offline: true })
        }
        await deleteOfflineOrder(row.clientMutationId)
        synced++
      } catch (err: any) {
        if (!err?.response) {
          failed++
          break
        }
        await saveOfflineOrder({
          ...row,
          status: 'FAILED',
          error: err?.response?.data?.message || err?.message || 'Error de sincronización',
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
    isSyncing = false
  }
  return { synced, failed }
}
