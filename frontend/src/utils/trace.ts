import type { PrintBatch } from '../types/batch'
import type { Sale } from '../types/sale'
import type { Block } from '../types/block'

export interface AffectedSale {
  sale: Sale
  batch: PrintBatch
  /** 确认：批次快照含此版片；存疑：旧批次缺版本快照，只能按画稿推断 */
  certainty: '确认' | '存疑'
}

/**
 * 返修时列出受影响的已售作品：
 * 售出记录绑定批次，批次快照含本版片即确认涉及；
 * 旧批次没有版本快照，只能按画稿相同推断为存疑。
 * 已复检的退货视为已结案，不再列入。
 */
export function findAffectedSales(block: Block, batches: PrintBatch[], sales: Sale[]): AffectedSale[] {
  const batchById = new Map(batches.map((batch) => [batch.id, batch]))
  const affected: AffectedSale[] = []

  for (const sale of sales) {
    if (sale.status === '已复检') continue
    const batch = batchById.get(sale.batchId)
    if (!batch) continue

    if (batch.versionSnapshot) {
      if (batch.versionSnapshot.some((entry) => entry.blockId === block.id)) {
        affected.push({ sale, batch, certainty: '确认' })
      }
    } else if (batch.draftId === block.draftId) {
      affected.push({ sale, batch, certainty: '存疑' })
    }
  }

  return affected.sort((a, b) => b.sale.soldAt.localeCompare(a.sale.soldAt))
}

/** 批次是否缺版本快照（旧数据断点） */
export function hasSnapshotGap(batch: PrintBatch): boolean {
  return batch.versionSnapshot === undefined
}
