import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import Dexie from 'dexie'
import { db, initializeDatabase } from '../src/utils/db.ts'
import { findAffectedSales } from '../src/utils/trace.ts'
import { blockVersionStore } from '../src/stores/blockVersionStore.ts'

// ---- 场景 A：全新数据库（populate 种子数据）----
async function freshScenario() {
  await initializeDatabase()

  const versions = await db.blockVersions.toArray()
  const sales = await db.sales.toArray()
  const batches = await db.batches.toArray()
  const redVersions = versions.filter((v) => v.blockId === 'block-ll-03')
  const batch2 = batches.find((b) => b.id === 'batch-ll-002')
  const redSnap = batch2.blockSnapshots.find((s) => s.blockId === 'block-ll-03')

  console.assert(versions.length === 9, 'A: 种子版本应为 9 条，实际', versions.length)
  console.assert(sales.length === 4, 'A: 种子售出应为 4 条，实际', sales.length)
  console.assert(redVersions.length === 2 && redVersions[1].versionNo === 2, 'A: 红版应有两版')
  console.assert(redSnap.versionNo === 1, 'A: 第二批次必须固定红版首版（返修不改旧批）')
  console.assert(redSnap.legacy !== true, 'A: 种子快照不是旧档补建')

  const msBatch = batches.find((b) => b.id === 'batch-ms-001')
  console.assert(msBatch.blockSnapshots.length === 1 && msBatch.blockSnapshots[0].blockId === 'block-ms-01', 'A: 试印批只固定墨线版，未刻成版片留断点')

  const affected = findAffectedSales('block-ll-03', 2, { sales, batches })
  const pieceNos = affected.map((a) => a.sale.pieceNo)
  console.assert(affected.length === 4, 'A: 红版 v2 返修应影响两批共 4 件固定 v1 的已售，实际', affected.length)
  console.assert(pieceNos.includes('莲鱼-2602-018') && pieceNos.includes('莲鱼-2602-027'), 'A: 受影响作品编号应包含第二批作品', pieceNos)
  console.assert(affected.every((a) => a.reason === '固定旧版'), 'A: 有快照的批次应判定为固定旧版')
  console.assert(affected.find((a) => a.sale.pieceNo === '莲鱼-2602-027').sale.status === '已退货待复检', 'A: 退货作品保留关联仍可追溯')

  // 售出唯一性：重复作品编号拒绝登记
  const dup = await (await import('../src/stores/saleStore.ts')).saleStore.create({
    pieceNo: '莲鱼-2601-001',
    draftId: 'draft-liannian-youyu',
    batchId: 'batch-ll-002',
    soldAt: '2026-03-01',
    buyer: '重复买家',
  })
  console.assert(dup.ok === false, 'A: 同一作品编号重复售出必须被拒')

  // 退货：保留 batchId 关联
  const saleStore = (await import('../src/stores/saleStore.ts')).saleStore
  const target = sales.find((s) => s.pieceNo === '莲鱼-2602-018')
  await saleStore.registerReturn(target.id, { returnedAt: '2026-03-02', returnNote: '套色偏红线' })
  const after = await db.sales.get(target.id)
  console.assert(after.status === '已退货待复检' && after.batchId === target.batchId, 'A: 退货保留原批次关联')
  console.assert((await saleStore.findActiveByPieceNo(target.pieceNo)) !== undefined, 'A: 退货待复检仍占位，不能重售')

  console.log('场景 A（全新建库）通过')
}

// ---- 场景 B：v2 旧库升级到 v3（兼容迁移）----
async function migrationScenario() {
  // 先以 v2 结构建一份旧库
  const old = new Dexie('gbwoodprint-db')
  old.version(1).stores({
    drafts: 'id, genre, status, title',
    blocks: 'id, draftId, colorNo, carvedBy, state',
    carvers: 'id, specialty, skillLevel, name',
    batches: 'id, draftId, batchNo, printedAt',
    nodes: 'id, batchId, blockId, stage, seq, operator',
  })
  old.version(2).stores({
    drafts: 'id, genre, status, title, schemaRev',
    blocks: 'id, draftId, colorNo, carvedBy, state, schemaRev',
    carvers: 'id, specialty, skillLevel, name, schemaRev',
    batches: 'id, draftId, batchNo, printedAt, schemaRev',
    nodes: 'id, batchId, blockId, stage, seq, operator, schemaRev',
  })

  await old.open()
  await old.table('blocks').bulkAdd([
    { id: 'b1', draftId: 'd1', blockName: '墨线版', colorNo: 1, woodType: '黄杨', thicknessMm: 16, carvedBy: '齐师傅', state: '已修版', defectNote: '旧修版一次', schemaRev: 2 },
    { id: 'b2', draftId: 'd1', blockName: '黄版', colorNo: 2, woodType: '梨木', thicknessMm: 18, carvedBy: '周桂枝', state: '已刻成', defectNote: '', schemaRev: 2 },
    { id: 'b3', draftId: 'd1', blockName: '红版', colorNo: 3, woodType: '梨木', thicknessMm: 18, carvedBy: '陈小满', state: '在刻', defectNote: '', schemaRev: 2 },
  ])
  await old.table('nodes').bulkAdd([
    { id: 'n1', blockId: 'b1', stage: '刻版', seq: 1, operator: '齐师傅', startedAt: '2025-11-02T08:00', durationMin: 400, note: '成版', schemaRev: 2 },
    { id: 'n2', blockId: 'b1', stage: '修版', seq: 2, operator: '秦木生', startedAt: '2025-11-05T09:00', durationMin: 90, note: '修版', schemaRev: 2 },
  ])
  await old.table('batches').bulkAdd([
    { id: 'old-batch', draftId: 'd1', batchNo: '旧批-01', printedAt: '2025-12-01', paperBatch: '纸-1', inkNote: '', qty: 100, pieceCount: 2, qcNote: '', schemaRev: 2 },
  ])
  await old.close()

  // 打开应用数据库（单例），Dexie 会执行 v2 → v3 升级
  await db.open()

  const versions = await db.blockVersions.toArray()
  console.assert(versions.length === 2, 'B: 已刻成/已修版两块各补建一版，实际', versions.length)
  const v1 = versions.find((v) => v.blockId === 'b1')
  console.assert(v1.kind === '修版' && v1.versionNo === 1 && v1.legacy === true, 'B: b1 按修版节点补建旧档版本', JSON.stringify(v1))
  console.assert(v1.markedAt === '2025-11-05' && v1.markedBy === '秦木生', 'B: 补建版本取修版节点的时间与人')
  const v2v = versions.find((v) => v.blockId === 'b2')
  console.assert(v2v.kind === '刻成' && v2v.legacy === true, 'B: b2 按刻成状态补建')

  const batch = await db.batches.get('old-batch')
  console.assert(Array.isArray(batch.blockSnapshots) && batch.blockSnapshots.length === 2, 'B: 旧批回填两块快照，实际', batch.blockSnapshots)
  console.assert(batch.blockSnapshots.every((s) => s.legacy === true), 'B: 旧批快照全部标记旧档补建')
  console.assert(!batch.blockSnapshots.some((s) => s.blockId === 'b3'), 'B: 在刻版片不进快照（断点）')

  // 返修：在补建版之后递增 v2，旧批快照不动
  await blockVersionStore.load()
  const repair = await blockVersionStore.createRepairVersion({ blockId: 'b1', draftId: 'd1', markedBy: '秦木生', versionNote: '再次返修' })
  console.assert(repair.versionNo === 2 && repair.kind === '修版' && !repair.legacy, 'B: 返修在补建版之后递增为第 2 版')
  const oldBatchAfter = await db.batches.get('old-batch')
  console.assert(oldBatchAfter.blockSnapshots.find((s) => s.blockId === 'b1').versionNo === 1, 'B: 返修不改旧批次快照')

  await db.sales.add({ id: 's1', pieceNo: 'P-1', draftId: 'd1', batchId: 'old-batch', soldAt: '2025-12-05', buyer: '某店', status: '有效', returnNote: '', schemaRev: 3 })
  const sales = await db.sales.toArray()
  const batches = await db.batches.toArray()
  const affected = findAffectedSales('b1', 2, { sales, batches })
  console.assert(affected.length === 1 && affected[0].reason === '固定旧版', 'B: 旧档快照也能判定受影响作品')

  // 完全无快照的更旧批次 → 断点理由
  await db.batches.update('old-batch', { blockSnapshots: [] })
  const batches2 = await db.batches.toArray()
  const gapAffected = findAffectedSales('b1', 2, { sales, batches: batches2 })
  console.assert(gapAffected[0].reason === '批次未留该版快照', 'B: 缺快照时按断点列出', gapAffected[0]?.reason)

  console.log('场景 B（v2→v3 旧档迁移）通过')
}

async function main() {
  globalThis.indexedDB = new IDBFactory()
  const scenario = process.argv[2]
  if (scenario === 'A') await freshScenario()
  else if (scenario === 'B') await migrationScenario()
  else throw new Error('unknown scenario')
  console.log('断言通过 ✅')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
