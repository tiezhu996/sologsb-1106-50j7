import type { Block } from '../types/block'
import type { BlockVersion } from '../types/blockVersion'
import type { BatchBlockSnapshot, PrintBatch } from '../types/batch'
import type { SaleRecord } from '../types/sale'

/** 按画稿取逐块版片的最新留版（用于登记批次时固定本批版本）。 */
export function resolveLatestByBlock(
  blocks: Block[],
  versions: BlockVersion[],
): Array<{ block: Block; version: BlockVersion | null }> {
  return blocks
    .slice()
    .sort((a, b) => a.colorNo - b.colorNo)
    .map((block) => {
      const own = versions
        .filter((version) => version.blockId === block.id)
        .sort((a, b) => b.versionNo - a.versionNo)
      return { block, version: own[0] ?? null }
    })
}

/**
 * 登记批次时固定版本快照：只收录当时已经留版的版片；
 * 尚未刻成留版的版片不进快照，按断点展示。
 */
export function buildBatchSnapshots(
  blocks: Block[],
  versions: BlockVersion[],
): BatchBlockSnapshot[] {
  return resolveLatestByBlock(blocks, versions)
    .filter((entry): entry is { block: Block; version: BlockVersion } => entry.version !== null)
    .map(({ block, version }) => ({
      blockId: block.id,
      colorNo: block.colorNo,
      blockName: block.blockName,
      versionId: version.id,
      versionNo: version.versionNo,
      kind: version.kind,
      markedAt: version.markedAt,
      markedBy: version.markedBy,
      versionNote: version.versionNote,
      ...(version.legacy ? { legacy: true } : {}),
    }))
}

export type AffectReason = '固定旧版' | '批次未留该版快照'

export interface AffectedSale {
  sale: SaleRecord
  batch: PrintBatch
  /** 售出批次当时固定的本版版本；缺快照时为 undefined */
  snapshot?: BatchBlockSnapshot
  /** 返修后的最新版次 */
  currentVersionNo: number
  reason: AffectReason
}

/**
 * 返修前列出受影响的已售作品：
 * - 售出批次固定的本版版本早于返修后新版 → 确认受影响；
 * - 旧批次缺少该版快照（旧档或试印批）→ 无法确认，按断点列出待查。
 * 只列有效售出与退货待复检，已作结论的不重复打扰。
 */
export function findAffectedSales(
  blockId: string,
  nextVersionNo: number,
  context: { sales: SaleRecord[]; batches: PrintBatch[] },
): AffectedSale[] {
  const batchById = new Map(context.batches.map((batch) => [batch.id, batch]))
  const affected: AffectedSale[] = []

  for (const sale of context.sales) {
    if (sale.status !== '有效' && sale.status !== '已退货待复检') continue
    const batch = batchById.get(sale.batchId)
    if (!batch) continue

    const snapshot = batch.blockSnapshots?.find((item) => item.blockId === blockId)
    if (!snapshot) {
      affected.push({ sale, batch, currentVersionNo: nextVersionNo, reason: '批次未留该版快照' })
      continue
    }
    if (snapshot.versionNo < nextVersionNo) {
      affected.push({ sale, batch, snapshot, currentVersionNo: nextVersionNo, reason: '固定旧版' })
    }
  }

  affected.sort((a, b) => a.sale.pieceNo.localeCompare(b.sale.pieceNo, 'zh-CN'))
  return affected
}

/** 批次是否为旧档：没有任何版本快照。 */
export function batchHasSnapshotGap(batch: PrintBatch): boolean {
  return !batch.blockSnapshots || batch.blockSnapshots.length === 0
}
