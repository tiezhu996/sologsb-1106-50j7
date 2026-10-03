import type { BlockVersionKind } from './blockVersion'

/**
 * 登记批次时逐版固定的版本快照。
 * 之后版片返修只新增版本，不改动旧批次的快照，
 * 因此旧批次永远能还原「当时用了哪版版片」。
 */
export interface BatchBlockSnapshot {
  blockId: string
  colorNo: number
  blockName: string
  versionId: string
  versionNo: number
  kind: BlockVersionKind
  markedAt: string
  markedBy: string
  /** 快照中顺带保存的留版说明，防止旧版本记录日后缺字段 */
  versionNote: string
  /**
   * 旧批次登记时还没有版本留档，快照按兼容方式补建，
   * 追溯页展示「旧档断点」而不是伪装成当时真实留版。
   */
  legacy?: boolean
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
  /** 本批固定使用的逐版版本；旧批次可能为空，按断点兼容展示 */
  blockSnapshots?: BatchBlockSnapshot[]
  schemaRev?: number
}
