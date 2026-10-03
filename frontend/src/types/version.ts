export type VersionKind = '刻成留档' | '修版留档'

export interface BlockVersion {
  id: string
  blockId: string
  versionNo: number
  kind: VersionKind
  operator: string
  note: string
  createdAt: string
}
