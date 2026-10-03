export type SaleStatus = '有效' | '退货待复检' | '已复检'

export interface Sale {
  id: string
  artworkNo: string
  batchId: string
  soldAt: string
  buyer: string
  channel: string
  status: SaleStatus
  returnedAt?: string
  returnNote?: string
  recheckedAt?: string
  recheckNote?: string
}
