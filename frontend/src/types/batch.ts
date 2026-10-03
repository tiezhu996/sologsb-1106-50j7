import type { BlockName } from './block'

/**
 * 登记印制批次时固定的版片版本快照。
 * versionId / versionNo 为 null 表示该版片在登记前尚未留下版本（断点）。
 */
export interface BatchBlockVersion {
  blockId: string
  blockName: BlockName
  colorNo: number
  versionId: string | null
  versionNo: number | null
}

export interface PrintBatch {
  id: string
  draftId: string
  batchNo: string
  printedAt: string
  paperBatch: string
  inkNote: string
  qty: number
  pieceCount: number
  qcNote: string
  /** 旧批次可能缺少版本快照，追溯时按断点兼容展示 */
  versionSnapshot?: BatchBlockVersion[]
}
