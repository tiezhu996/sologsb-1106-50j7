/** 版片版本来源：标刻成留版，或返修后再留版 */
export type BlockVersionKind = '刻成' | '修版'

export interface BlockVersion {
  id: string
  blockId: string
  draftId: string
  /** 版次号，刻成为首版，每返修一次递增 */
  versionNo: number
  kind: BlockVersionKind
  /** 留版时间，格式 YYYY-MM-DD */
  markedAt: string
  /** 留版操作人（刻工或修版师傅） */
  markedBy: string
  /** 本次留版的线样/补版说明 */
  versionNote: string
  /**
   * 旧档迁移时按工序节点补建的版本没有真实留档，
   * 追溯链上以「旧档补建」断点样式展示。
   */
  legacy?: boolean
  schemaRev?: number
}
