import { writable } from 'svelte/store'
import type { SaleRecord, SaleStatus } from '../types/sale'
import { db } from '../utils/db'

const saleList = writable<SaleRecord[]>([])

async function load(): Promise<void> {
  const records = await db.sales.toArray()
  records.sort((a, b) => b.soldAt.localeCompare(a.soldAt) || a.pieceNo.localeCompare(b.pieceNo, 'zh-CN'))
  saleList.set(records)
}

async function findActiveByPieceNo(pieceNo: string): Promise<SaleRecord | undefined> {
  const normalized = pieceNo.trim()
  const records = await db.sales.where('pieceNo').equals(normalized).toArray()
  return records.find((sale) => sale.status === '有效' || sale.status === '已退货待复检')
}

async function create(input: {
  pieceNo: string
  draftId: string
  batchId: string
  soldAt: string
  buyer: string
}): Promise<{ ok: boolean; message: string }> {
  const pieceNo = input.pieceNo.trim()
  if (!pieceNo || !input.draftId || !input.batchId || !input.soldAt || !input.buyer.trim()) {
    return { ok: false, message: '请补全作品编号、画稿、印制批次、售出日期与去向。' }
  }

  // 同一作品只留一条有效售出：退货待复检的作品也不能重复登记，复检后再议。
  const conflict = await findActiveByPieceNo(pieceNo)
  if (conflict) {
    return {
      ok: false,
      message:
        conflict.status === '已退货待复检'
          ? `作品 ${pieceNo} 已退货待复检，须先完成复检，不能重复登记售出。`
          : `作品 ${pieceNo} 已有一条有效售出，同一作品不能重复登记。`,
    }
  }

  const sale: SaleRecord = {
    id: `sale-${crypto.randomUUID()}`,
    pieceNo,
    draftId: input.draftId,
    batchId: input.batchId,
    soldAt: input.soldAt,
    buyer: input.buyer.trim(),
    status: '有效',
    returnNote: '',
  }
  await db.sales.add(sale)
  await load()
  return { ok: true, message: '' }
}

/**
 * 退货：保留作品与批次的原关联，仅转为待复检；
 * 不改批次版本快照，也不另开新记录。
 */
async function registerReturn(
  saleId: string,
  input: { returnedAt: string; returnNote: string },
): Promise<void> {
  const sale = await db.sales.get(saleId)
  if (!sale || sale.status !== '有效') return
  await db.sales.update(saleId, {
    status: '已退货待复检' satisfies SaleStatus,
    returnedAt: input.returnedAt,
    returnNote: input.returnNote.trim() || '买家退回，原因待补记。',
  })
  await load()
}

async function listByBatch(batchId: string): Promise<SaleRecord[]> {
  return db.sales.where('batchId').equals(batchId).toArray()
}

export const saleStore = {
  subscribe: saleList.subscribe,
  load,
  findActiveByPieceNo,
  create,
  registerReturn,
  listByBatch,
}
