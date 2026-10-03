import { derived, get, writable } from 'svelte/store'
import type { Sale } from '../types/sale'
import { db } from '../utils/db'

const saleList = writable<Sale[]>([])

/** 作品编号 → 当前有效售出，同一作品只留一条有效售出 */
const activeByArtwork = derived(saleList, ($sales) => {
  const active: Record<string, Sale> = {}
  for (const sale of $sales) {
    if (sale.status === '有效') active[sale.artworkNo] = sale
  }
  return active
})

async function load(): Promise<void> {
  const records = await db.sales.toArray()
  records.sort((a, b) => b.soldAt.localeCompare(a.soldAt) || a.artworkNo.localeCompare(b.artworkNo))
  saleList.set(records)
}

export interface RegisterResult {
  ok: boolean
  message: string
}

async function register(input: Pick<Sale, 'artworkNo' | 'batchId' | 'soldAt' | 'buyer' | 'channel'>): Promise<RegisterResult> {
  const artworkNo = input.artworkNo.trim()
  if (!artworkNo || !input.batchId) {
    return { ok: false, message: '请填写作品编号并绑定印制批次。' }
  }

  const duplicated = get(saleList).find((sale) => sale.artworkNo === artworkNo && sale.status === '有效')
  if (duplicated) {
    return { ok: false, message: `作品编号 ${artworkNo} 已有有效售出记录，同一作品只留一条有效售出。` }
  }

  await db.sales.add({
    id: `sale-${crypto.randomUUID()}`,
    artworkNo,
    batchId: input.batchId,
    soldAt: input.soldAt,
    buyer: input.buyer.trim() || '未留名',
    channel: input.channel.trim() || '门市',
    status: '有效',
  })
  await load()
  return { ok: true, message: `作品 ${artworkNo} 已绑定批次并登记售出。` }
}

/** 退货保留原批次关联，仅把状态改为待复检 */
async function markReturned(id: string, note: string): Promise<void> {
  await db.sales.update(id, {
    status: '退货待复检',
    returnedAt: new Date().toISOString().slice(0, 10),
    returnNote: note.trim() || '买家退回，待复检套色。',
  })
  await load()
}

async function markRechecked(id: string, note: string): Promise<void> {
  await db.sales.update(id, {
    status: '已复检',
    recheckedAt: new Date().toISOString().slice(0, 10),
    recheckNote: note.trim() || '复检完毕，结果已留档。',
  })
  await load()
}

export const saleStore = {
  subscribe: saleList.subscribe,
  activeByArtwork,
  load,
  register,
  markReturned,
  markRechecked,
}
