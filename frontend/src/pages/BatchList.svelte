<script lang="ts">
  import { onMount } from 'svelte'
  import EmptyBox from '../components/common/EmptyBox.svelte'
  import { draftStore } from '../stores/draftStore'
  import { blockStore } from '../stores/blockStore'
  import { blockVersionStore } from '../stores/blockVersionStore'
  import { buildDeviationNote } from '../utils/seq'
  import { buildBatchSnapshots, resolveLatestByBlock } from '../utils/trace'
  import { downloadJson } from '../utils/export'
  import { db } from '../utils/db'
  import type { PrintBatch } from '../types/batch'
  import type { BlockVersion } from '../types/blockVersion'

  let batches = $state<PrintBatch[]>([])
  let showForm = $state(false)
  let draftId = $state('')
  let batchNo = $state('')
  let printedAt = $state(new Date().toISOString().slice(0, 10))
  let paperBatch = $state('')
  let inkNote = $state('')
  let qty = $state(100)
  let pieceCount = $state(4)
  let qcNote = $state('')
  let deviations = $state<Record<string, string>>({})
  let formMessage = $state('')

  const selectedDraft = $derived($draftStore.find((draft) => draft.id === draftId) ?? null)
  const selectedBlocks = $derived(
    draftId ? [...$blockStore].filter((block) => block.draftId === draftId).sort((a, b) => a.colorNo - b.colorNo) : [],
  )

  // 登记前预览：登记时逐版固定当时的最新留版
  const versionPreview = $derived(
    draftId
      ? resolveLatestByBlock(
          [...$blockStore].filter((block) => block.draftId === draftId),
          $blockVersionStore,
        )
      : [],
  )
  const readyCount = $derived(versionPreview.filter((entry) => entry.version !== null).length)
  const pendingBlocks = $derived(versionPreview.filter((entry) => entry.version === null))

  function cnNumeral(n: number): string {
    return ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][n - 1] ?? String(n)
  }

  function versionChip(version: BlockVersion | null): { text: string; tone: string } {
    if (!version) return { text: '尚未留版', tone: 'pending' }
    return { text: `第${cnNumeral(version.versionNo)}版 · ${version.kind}`, tone: version.legacy ? 'legacy' : 'current' }
  }

  onMount(() => {
    void Promise.all([draftStore.load(), blockStore.load(), blockVersionStore.load(), refreshBatches()])
  })

  async function refreshBatches(): Promise<void> {
    const records = await db.batches.toArray()
    records.sort((a, b) => b.printedAt.localeCompare(a.printedAt) || b.batchNo.localeCompare(a.batchNo, 'zh-CN'))
    batches = records
  }

  function openForm(): void {
    showForm = true
    formMessage = ''
    if (!draftId) {
      const firstDraft = $draftStore[0]
      if (firstDraft) selectDraft(firstDraft.id)
    }
  }

  function selectDraft(nextId: string): void {
    draftId = nextId
    deviations = {}
    const target = $draftStore.find((draft) => draft.id === nextId)
    if (target) batchNo = `${target.title}-${new Date().getFullYear()}-01`
  }

  function draftTitle(targetId: string): string {
    return $draftStore.find((draft) => draft.id === targetId)?.title ?? '未知画稿'
  }

  async function submitBatch(): Promise<void> {
    if (!draftId || !batchNo.trim() || !paperBatch.trim() || qty <= 0 || pieceCount <= 0) {
      formMessage = '请选择画稿，并补全批次号、纸张批号和印数。'
      return
    }

    const deviationText = buildDeviationNote(
      selectedBlocks.map((block) => ({
        blockName: block.blockName,
        deviation: deviations[block.id] ?? '',
      })),
    )

    await db.batches.add({
      id: `batch-${crypto.randomUUID()}`,
      draftId,
      batchNo: batchNo.trim(),
      printedAt,
      paperBatch: paperBatch.trim(),
      inkNote: inkNote.trim() || '颜料与胶量待续记',
      qty: Number(qty),
      pieceCount: Number(pieceCount),
      qcNote: qcNote.trim() ? `${qcNote.trim()}；${deviationText}` : deviationText,
      // 登记即固定本批版本，之后返修不改旧批次
      blockSnapshots: buildBatchSnapshots(selectedBlocks, $blockVersionStore),
    })

    await refreshBatches()
    showForm = false
    batchNo = ''
    paperBatch = ''
    inkNote = ''
    qty = 100
    pieceCount = 4
    qcNote = ''
    deviations = {}
    formMessage = ''
  }

  async function exportArchive(): Promise<void> {
    const [drafts, blocks, carvers, nodes, blockVersions, sales] = await Promise.all([
      db.drafts.toArray(),
      db.blocks.toArray(),
      db.carvers.toArray(),
      db.nodes.toArray(),
      db.blockVersions.toArray(),
      db.sales.toArray(),
    ])
    downloadJson('木版年画工序档案.json', {
      exportedAt: new Date().toISOString(),
      drafts,
      blocks,
      batches,
      carvers,
      nodes,
      blockVersions,
      sales,
    })
  }
</script>

<svelte:head>
  <title>印制批次登记 · 木版年画刻版工序档案</title>
</svelte:head>

<div class="page-heading">
  <div>
    <p class="eyebrow">套色印制留档</p>
    <h1>印制批次登记</h1>
    <p>登记纸张、颜料与每版印次，逐版留下套色偏差。</p>
  </div>
  <div class="heading-actions">
    <button class="button ghost" type="button" onclick={exportArchive}>导出 JSON</button>
    <button class="button primary" data-testid="new-batch" type="button" onclick={openForm}>新建批次</button>
  </div>
</div>

<section class="summary-strip four">
  <div><span>登记批次</span><strong data-testid="count-batch">{batches.length}</strong></div>
  <div><span>累计印数</span><strong>{batches.reduce((sum, batch) => sum + batch.qty, 0)}</strong></div>
  <div><span>覆盖画稿</span><strong>{new Set(batches.map((batch) => batch.draftId)).size}</strong></div>
  <div><span>在册画稿</span><strong>{$draftStore.length}</strong></div>
</section>

{#if showForm}
  <section class="panel form-panel" data-testid="form-batch">
    <div class="panel-heading">
      <div>
        <span class="section-kicker">新印批</span>
        <h2>登记纸张与套色检查</h2>
      </div>
      <button class="text-button" type="button" onclick={() => (showForm = false)}>收起</button>
    </div>

    <div class="form-grid three">
      <label>
        <span>所属画稿</span>
        <select data-testid="field-draftId" value={draftId} onchange={(event) => selectDraft((event.currentTarget as HTMLSelectElement).value)}>
          <option value="">请选择</option>
          {#each $draftStore as draft}<option value={draft.id}>{draft.title} · {draft.genre}</option>{/each}
        </select>
      </label>
      <label>
        <span>批次号</span>
        <input data-testid="field-batchNo" bind:value={batchNo} />
      </label>
      <label>
        <span>印制日期</span>
        <input data-testid="field-printedAt" type="date" bind:value={printedAt} />
      </label>
      <label>
        <span>纸张批号</span>
        <input data-testid="field-paperBatch" bind:value={paperBatch} placeholder="如：泾县-2605" />
      </label>
      <label>
        <span>总印数</span>
        <input data-testid="field-qty" type="number" min="1" bind:value={qty} />
      </label>
      <label>
        <span>每版印次</span>
        <input data-testid="field-pieceCount" type="number" min="1" bind:value={pieceCount} />
      </label>
      <label class="wide">
        <span>颜料与胶量</span>
        <textarea data-testid="field-inkNote" rows="2" bind:value={inkNote} placeholder="分色记录颜料、胶量与稀稠"></textarea>
      </label>
    </div>

    {#if selectedDraft}
      <div class="deviation-block">
        <div class="section-title-row">
          <div>
            <span class="section-kicker">逐版检查</span>
            <h3>{selectedDraft.title}套色偏差</h3>
          </div>
          <span>{selectedBlocks.length} 块版片</span>
        </div>
        <div class="deviation-grid">
          {#each selectedBlocks as block}
            <label>
              <span><b>{block.colorNo}</b>{block.blockName}</span>
              <input
                data-testid={`field-deviation-${block.id}`}
                value={deviations[block.id] ?? ''}
                oninput={(event) => (deviations[block.id] = (event.currentTarget as HTMLInputElement).value)}
                placeholder="如：右下角偏红线半根"
              />
            </label>
          {/each}
        </div>
      </div>

      <div class="version-fix-block" data-testid="version-fix">
        <div class="section-title-row">
          <div>
            <span class="section-kicker">本批固定版本</span>
            <h3>登记后不再随返修改变</h3>
          </div>
          <span>{readyCount}/{versionPreview.length} 块已留版</span>
        </div>
        <div class="version-fix-grid">
          {#each versionPreview as entry}
            {@const chip = versionChip(entry.version)}
            <div class="version-fix-item tone-{chip.tone}">
              <span><b>{entry.block.colorNo}</b>{entry.block.blockName}</span>
              <strong>{chip.text}</strong>
              {#if entry.version}
                <small>{entry.version.markedAt.replace(/-/g, '.')} · {entry.version.markedBy}</small>
              {:else}
                <small>该版尚未刻成留版，本批不录快照，追溯按断点展示</small>
              {/if}
            </div>
          {/each}
        </div>
        {#if pendingBlocks.length > 0}
          <p class="form-message" data-testid="version-pending-warning">
            {pendingBlocks.map((entry) => entry.block.blockName).join('、')}尚未留版；
            本批可按试印登记，但只固定已留版版片，未留版部分日后无法还原用版。
          </p>
        {/if}
      </div>
    {/if}

    <label class="stacked-field">
      <span>总检说明</span>
      <textarea data-testid="field-qcNote" rows="2" bind:value={qcNote} placeholder="走版、纸面洇墨与整体套准情况"></textarea>
    </label>

    {#if formMessage}<p class="form-message">{formMessage}</p>{/if}
    <div class="form-actions">
      <button class="button primary" data-testid="submit-batch" type="button" onclick={submitBatch}>保存批次</button>
      <button class="button ghost" type="button" onclick={() => (showForm = false)}>取消</button>
    </div>
  </section>
{/if}

{#if batches.length === 0}
  <EmptyBox
    title="尚无印制批次"
    message="版片刻成后即可逐版试印，登记纸张与套色偏差。"
    actionLabel="新建批次"
    onaction={openForm}
  />
{:else}
  <section class="batch-list">
    {#each batches as batch (batch.id)}
      <article class="panel batch-item" data-testid="row-batch">
        <div class="batch-number">
          <span>{batch.printedAt.replace(/-/g, '.')}</span>
          <h2>{batch.batchNo}</h2>
          <p>{draftTitle(batch.draftId)} · {batch.paperBatch}</p>
        </div>
        <div class="batch-counts">
          <div><span>总印数</span><strong>{batch.qty}</strong></div>
          <div><span>每版印次</span><strong>{batch.pieceCount}</strong></div>
        </div>
        <div class="batch-notes">
          <p><b>颜料胶量：</b>{batch.inkNote}</p>
          <p><b>套色检查：</b>{batch.qcNote}</p>
          <div class="snapshot-strip" data-testid={`snapshots-${batch.id}`}>
            {#if !batch.blockSnapshots || batch.blockSnapshots.length === 0}
              <span class="gap-tag">旧档断点：本批登记时未留版本快照，无法还原当时用版。</span>
            {:else}
              {#each [...batch.blockSnapshots].sort((a, b) => a.colorNo - b.colorNo) as snapshot}
                <span class="snapshot-chip legacy-{snapshot.legacy ? true : false}" title={snapshot.versionNote}>
                  <b>{snapshot.blockName}</b>
                  第{cnNumeral(snapshot.versionNo)}版 · {snapshot.kind}
                  {#if snapshot.legacy}<em>旧档补建</em>{/if}
                </span>
              {/each}
            {/if}
          </div>
        </div>
      </article>
    {/each}
  </section>
{/if}
