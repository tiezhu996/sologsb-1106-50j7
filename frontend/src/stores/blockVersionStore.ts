import { writable } from 'svelte/store'
import type { BlockVersion } from '../types/blockVersion'
import { db } from '../utils/db'

const versionList = writable<BlockVersion[]>([])

async function load(): Promise<void> {
  const records = await db.blockVersions.toArray()
  records.sort((a, b) => a.blockId.localeCompare(b.blockId) || a.versionNo - b.versionNo)
  versionList.set(records)
}

function byBlock(records: BlockVersion[], blockId: string): BlockVersion[] {
  return records
    .filter((version) => version.blockId === blockId)
    .sort((a, b) => a.versionNo - b.versionNo)
}

async function listForBlock(blockId: string): Promise<BlockVersion[]> {
  const records = await db.blockVersions.where('blockId').equals(blockId).toArray()
  return records.sort((a, b) => a.versionNo - b.versionNo)
}

async function listForDraft(draftId: string): Promise<BlockVersion[]> {
  return db.blockVersions.where('draftId').equals(draftId).toArray()
}

/**
 * 标刻成时留首版。版片已有任意版本时不重复留版
 * （刻成只发生一次，之后再改一律走返修）。
 */
async function ensureCarvedVersion(input: {
  blockId: string
  draftId: string
  markedBy: string
  versionNote: string
  markedAt?: string
}): Promise<BlockVersion> {
  const existing = await listForBlock(input.blockId)
  if (existing.length > 0) {
    return existing[existing.length - 1]!
  }

  const version: BlockVersion = {
    id: `version-${crypto.randomUUID()}`,
    blockId: input.blockId,
    draftId: input.draftId,
    versionNo: 1,
    kind: '刻成',
    markedAt: input.markedAt ?? new Date().toISOString().slice(0, 10),
    markedBy: input.markedBy,
    versionNote: input.versionNote,
  }
  await db.blockVersions.add(version)
  await load()
  return version
}

/**
 * 返修后留新版：版次在最新一版上递增，旧版本永不改动。
 */
async function createRepairVersion(input: {
  blockId: string
  draftId: string
  markedBy: string
  versionNote: string
  markedAt?: string
}): Promise<BlockVersion> {
  const existing = await listForBlock(input.blockId)
  const version: BlockVersion = {
    id: `version-${crypto.randomUUID()}`,
    blockId: input.blockId,
    draftId: input.draftId,
    versionNo: existing.reduce((max, item) => Math.max(max, item.versionNo), 0) + 1,
    kind: '修版',
    markedAt: input.markedAt ?? new Date().toISOString().slice(0, 10),
    markedBy: input.markedBy,
    versionNote: input.versionNote,
  }
  await db.blockVersions.add(version)
  await load()
  return version
}

export const blockVersionStore = {
  subscribe: versionList.subscribe,
  load,
  byBlock,
  listForBlock,
  listForDraft,
  ensureCarvedVersion,
  createRepairVersion,
}
