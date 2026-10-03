/** 售出状态：有效（在买家手中）或已退货待复检 */
export type SaleStatus = '有效' | '已退货待复检'

export interface SaleRecord {
  id: string
  /** 作品编号，逐张年画唯一；同一编号只保留一条有效售出 */
  pieceNo: string
  draftId: string
  /** 售出时固定绑定的印制批次，之后批次版本不可再变 */
  batchId: string
  soldAt: string
  /** 买家或去向 */
  buyer: string
  status: SaleStatus
  /** 退货/复检说明 */
  returnNote: string
  /** 退货日期；有效售出为空 */
  returnedAt?: string
  schemaRev?: number
}
