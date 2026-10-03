import { derived, writable } from 'svelte/store'
import type { BlockVersion, VersionKind } from '../types/version'
import { db } from '../utils/db'

const versionList = writable<BlockVersion[]>([])

/** 每块版片的最新留档版本，供登记批次时固定快照 */
const latestByBlock = derived(versionList, ($versions) => {
  const latest: Record<string, BlockVersion> = {}
  for (const version of $versions) {
    const current = latest[version.blockId]
    if (!current || version.versionNo > current.versionNo) latest[version.blockId] = version
  }
  return latest
})

async function load(): Promise<void> {
  const records = await db.versions.toArray()
  records.sort((a, b) => a.blockId.localeCompare(b.blockId) || a.versionNo - b.versionNo)
  versionList.set(records)
}

/**
 * 标刻成或修版时留下版片版本。
 * 只新增留档记录，不回写任何历史批次快照。
 */
async function record(blockId: string, kind: VersionKind, operator: string, note: string): Promise<BlockVersion> {
  const version = await db.transaction('rw', db.versions, async () => {
    const existing = await db.versions.where('blockId').equals(blockId).toArray()
    const nextNo = Math.max(0, ...existing.map((item) => item.versionNo)) + 1
    const entry: BlockVersion = {
      id: `version-${crypto.randomUUID()}`,
      blockId,
      versionNo: nextNo,
      kind,
      operator: operator.trim() || '当班刻工',
      note: note.trim() || (kind === '刻成留档' ? '标刻成验线，留档版本。' : '修版留档。'),
      createdAt: new Date().toISOString().slice(0, 16),
    }
    await db.versions.add(entry)
    return entry
  })
  await load()
  return version
}

export const versionStore = {
  subscribe: versionList.subscribe,
  latestByBlock,
  load,
  record,
}
