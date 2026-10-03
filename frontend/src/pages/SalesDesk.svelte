<script lang="ts">
  import { onMount } from 'svelte'
  import { link, location } from 'svelte-spa-router'
  import EmptyBox from '../components/common/EmptyBox.svelte'
  import { draftStore } from '../stores/draftStore'
  import { blockStore } from '../stores/blockStore'
  import { blockVersionStore } from '../stores/blockVersionStore'
  import { saleStore } from '../stores/saleStore'
  import { batchHasSnapshotGap } from '../utils/trace'
  import { db } from '../utils/db'
  import type { Draft } from '../types/draft'
  import type { PrintBatch } from '../types/batch'
  import type { SaleRecord, SaleStatus } from '../types/sale'
  import type { BlockVersion } from '../types/blockVersion'

  type StatusFilter = SaleStatus | '全部'

  let sales = $state<SaleRecord[]>([])
  let batches = $state<PrintBatch[]>([])
  let showForm = $state(false)
  let pieceNo = $state('')
  let draftId = $state('')
  let batchId = $state('')
  let soldAt = $state(new Date().toISOString().slice(0, 10))
  let buyer = $state('')
  let statusFilter = $state<StatusFilter>('全部')
  let formMessage = $state('')
  let expandedSaleId = $state<string | null>(null)

  // 退货表单
  let returningSaleId = $state<string | null>(null)
  let returnedAt = $state(new Date().toISOString().slice(0, 10))
  let returnNote = $state('')
  let returnFeedback = $state('')

  const cnNumerals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  const filters: StatusFilter[] = ['全部', '有效', '已退货待复检']

  const filteredSales = $derived(
    sales.filter((sale) => statusFilter === '全部' || sale.status === statusFilter),
  )

  const batchesForSelectedDraft = $derived(
    draftId ? batches.filter((batch) => batch.draftId === draftId).sort((a, b) => b.printedAt.localeCompare(a.printedAt)) : [],
  )

  onMount(() => {
    void Promise.all([
      draftStore.load(),
      blockStore.load(),
      blockVersionStore.load(),
      saleStore.load(),
      refreshSales(),
      refreshBatches(),
    ])
    const query = $location.split('?')[1]
    if (query) {
      const params = new URLSearchParams(query)
      const target = params.get('sale')
      if (target) expandedSaleId = target
    }
  })

  async function refreshSales(): Promise<void> {
    sales = await db.sales.toArray()
    sales.sort((a, b) => b.soldAt.localeCompare(a.soldAt) || a.pieceNo.localeCompare(b.pieceNo, 'zh-CN'))
  }

  async function refreshBatches(): Promise<void> {
    batches = await db.batches.toArray()
  }

  function openForm(): void {
    showForm = true
    formMessage = ''
    if (!draftId) {
      const first = $draftStore[0]
      if (first) selectDraft(first.id)
    }
  }

  function selectDraft(nextId: string): void {
    draftId = nextId
    batchId = ''
    const next = batchesForSelectedDraft[0]
    if (next) batchId = next.id
  }

  function draftOf(sale: SaleRecord): Draft | undefined {
    return $draftStore.find((draft) => draft.id === sale.draftId)
  }

  function batchOf(sale: SaleRecord): PrintBatch | undefined {
    return batches.find((batch) => batch.id === sale.batchId)
  }

  function versionsFor(blockId: string): BlockVersion[] {
    return $blockVersionStore
      .filter((version) => version.blockId === blockId)
      .sort((a, b) => a.versionNo - b.versionNo)
  }

  function cnNumeral(n: number): string {
    return cnNumerals[n - 1] ?? String(n)
  }

  async function submitSale(): Promise<void> {
    const result = await saleStore.create({
      pieceNo,
      draftId,
      batchId,
      soldAt,
      buyer,
    })
    if (!result.ok) {
      formMessage = result.message
      return
    }
    await refreshSales()
    pieceNo = ''
    buyer = ''
    formMessage = ''
    showForm = false
  }

  function startReturn(sale: SaleRecord): void {
    returningSaleId = sale.id
    returnedAt = new Date().toISOString().slice(0, 10)
    returnNote = ''
    returnFeedback = ''
  }

  function cancelReturn(): void {
    returningSaleId = null
    returnNote = ''
    returnFeedback = ''
  }

  async function submitReturn(): Promise<void> {
    if (!returningSaleId) return
    if (!returnNote.trim()) {
      returnFeedback = '请写明退货原因或观察到的套色偏差。'
      return
    }
    await saleStore.registerReturn(returningSaleId, { returnedAt, returnNote })
    await refreshSales()
    cancelReturn()
  }

  function toggleTrace(saleId: string): void {
    expandedSaleId = expandedSaleId === saleId ? null : saleId
  }
</script>

<svelte:head>
  <title>售出登记与追溯 · 木版年画刻版工序档案</title>
</svelte:head>

<div class="page-heading">
  <div>
    <p class="eyebrow">作品去向与追溯</p>
    <h1>售出登记与追溯</h1>
    <p>按作品编号绑定印制批次；同一作品只留一条有效售出，退货保留原关联并待复检。</p>
  </div>
  <div class="heading-actions">
    <button class="button primary" data-testid="new-sale" type="button" onclick={openForm}>登记售出</button>
  </div>
</div>

<section class="summary-strip four">
  <div><span>登记作品</span><strong data-testid="count-sale">{sales.length}</strong></div>
  <div><span>有效售出</span><strong>{sales.filter((sale) => sale.status === '有效').length}</strong></div>
  <div><span>退货待复检</span><strong>{sales.filter((sale) => sale.status === '已退货待复检').length}</strong></div>
  <div><span>涉及批次</span><strong>{new Set(sales.map((sale) => sale.batchId)).size}</strong></div>
</section>

{#if showForm}
  <section class="panel form-panel" data-testid="form-sale">
    <div class="panel-heading">
      <div>
        <span class="section-kicker">新售作品</span>
        <h2>绑定作品编号与印制批次</h2>
      </div>
      <button class="text-button" type="button" onclick={() => (showForm = false)}>收起</button>
    </div>

    <div class="form-grid three">
      <label>
        <span>作品编号</span>
        <input data-testid="field-pieceNo" bind:value={pieceNo} placeholder="如：莲鱼-2602-031" />
      </label>
      <label>
        <span>所属画稿</span>
        <select data-testid="field-sale-draftId" value={draftId} onchange={(event) => selectDraft((event.currentTarget as HTMLSelectElement).value)}>
          <option value="">请选择</option>
          {#each $draftStore as draft}<option value={draft.id}>{draft.title} · {draft.genre}</option>{/each}
        </select>
      </label>
      <label>
        <span>印制批次</span>
        <select data-testid="field-sale-batchId" bind:value={batchId}>
          <option value="">请选择</option>
          {#each batchesForSelectedDraft as batch}<option value={batch.id}>{batch.batchNo} · {batch.printedAt}</option>{/each}
        </select>
      </label>
      <label>
        <span>售出日期</span>
        <input data-testid="field-soldAt" type="date" bind:value={soldAt} />
      </label>
      <label class="wide">
        <span>买家 / 去向</span>
        <input data-testid="field-buyer" bind:value={buyer} placeholder="如：洛阳纸马店" />
      </label>
    </div>

    {#if batchesForSelectedDraft.length === 0}
      <p class="form-message">该画稿尚无印制批次，请先在印制批次登记页建档。</p>
    {/if}
    {#if formMessage}<p class="form-message">{formMessage}</p>{/if}
    <div class="form-actions">
      <button class="button primary" data-testid="submit-sale" type="button" onclick={submitSale}>保存售出</button>
      <button class="button ghost" type="button" onclick={() => (showForm = false)}>取消</button>
    </div>
  </section>
{/if}

<section class="filter-bar" aria-label="售出筛选">
  <label>
    <span>按状态</span>
    <select data-testid="filter-sale-status" bind:value={statusFilter}>
      {#each filters as item}<option value={item}>{item === '全部' ? '全部状态' : item}</option>{/each}
    </select>
  </label>
  <p>当前显示 {filteredSales.length} 件作品</p>
</section>

{#if filteredSales.length === 0}
  <EmptyBox
    title="尚无售出记录"
    message="作品售出时按编号绑定印制批次，日后可沿作品追溯到批次、版片版本与修版记录。"
    actionLabel="登记售出"
    onaction={openForm}
  />
{:else}
  <section class="sale-list">
    {#each filteredSales as sale (sale.id)}
      {@const draft = draftOf(sale)}
      {@const batch = batchOf(sale)}
      <article class="panel sale-item" class:expanded={expandedSaleId === sale.id} data-testid="row-sale">
        <div class="sale-main">
          <div class="sale-identity">
            <span class="tag status-tag {sale.status === '有效' ? 'genre-3' : 'status-1'}">{sale.status}</span>
            <h2>{sale.pieceNo}</h2>
            <p>{draft?.title ?? '未知画稿'} · {sale.buyer}</p>
          </div>
          <div class="sale-meta">
            <div><span>售出日期</span><strong>{sale.soldAt.replace(/-/g, '.')}</strong></div>
            {#if sale.returnedAt}
              <div><span>退货日期</span><strong>{sale.returnedAt.replace(/-/g, '.')}</strong></div>
            {/if}
          </div>
          <div class="sale-actions">
            <button class="button ghost" data-testid={`trace-${sale.id}`} type="button" onclick={() => toggleTrace(sale.id)}>
              {expandedSaleId === sale.id ? '收起追溯' : '展开追溯'}
            </button>
            {#if sale.status === '有效' && returningSaleId !== sale.id}
              <button class="button danger" data-testid={`return-${sale.id}`} type="button" onclick={() => startReturn(sale)}>登记退货</button>
            {/if}
          </div>
        </div>

        {#if returningSaleId === sale.id}
          <div class="return-box" data-testid="return-box">
            <label class="stacked-field">
              <span>退货日期</span>
              <input type="date" data-testid="returnedAt" bind:value={returnedAt} />
            </label>
            <label class="stacked-field">
              <span>退货原因 / 观察到的偏差（原批次关联保留，进入待复检）</span>
              <textarea rows="2" data-testid="returnNote" bind:value={returnNote} placeholder="如：红版左肩套色错位约半线"></textarea>
            </label>
            <div class="form-actions">
              <button class="button primary" data-testid="submit-return" type="button" onclick={submitReturn}>确认退货待复检</button>
              <button class="button ghost" type="button" onclick={cancelReturn}>取消</button>
            </div>
            {#if returnFeedback}<p class="form-message">{returnFeedback}</p>{/if}
          </div>
        {/if}

        {#if sale.returnNote && returningSaleId !== sale.id}
          <p class="return-note"><b>退货说明：</b>{sale.returnNote}</p>
        {/if}

        {#if expandedSaleId === sale.id}
          <div class="trace-chain" data-testid={`trace-chain-${sale.id}`}>
            <!-- 第一层：作品 → 批次 -->
            <section class="trace-step">
              <h3><span class="step-no">壹</span>印制批次</h3>
              {#if batch}
                <div class="trace-card">
                  <div>
                    <strong>{batch.batchNo}</strong>
                    <p>{batch.printedAt.replace(/-/g, '.')} 印 · 纸张 {batch.paperBatch} · 印数 {batch.qty}</p>
                    <p class="trace-qc">{batch.qcNote}</p>
                  </div>
                  <a class="mini-link" use:link href="/batches">前往批次登记</a>
                </div>
              {:else}
                <div class="trace-gap">断点：关联批次 {sale.batchId} 已不存在，原批次信息缺失。</div>
              {/if}
            </section>

            <!-- 第二层：批次 → 版片版本 -->
            <section class="trace-step">
              <h3><span class="step-no">贰</span>本批固定版片版本</h3>
              {#if !batch}
                <div class="trace-gap">断点：无批次可查版本快照。</div>
              {:else if batchHasSnapshotGap(batch)}
                <div class="trace-gap">
                  旧档断点：本批登记时尚未建立版本留档，无法还原当时使用哪版版片，仅能参照版片现状。
                </div>
              {:else}
                <div class="version-lineage">
                  {#each [...(batch.blockSnapshots ?? [])].sort((a, b) => a.colorNo - b.colorNo) as snapshot}
                    <div class="lineage-card legacy-{snapshot.legacy ? true : false}">
                      <header>
                        <b>{snapshot.blockName}</b>
                        <span class="tag version-kind kind-{snapshot.kind}">第{cnNumeral(snapshot.versionNo)}版 · {snapshot.kind}</span>
                        {#if snapshot.legacy}<span class="gap-tag">旧档补建</span>{/if}
                      </header>
                      <p>{snapshot.versionNote}</p>
                      <small>{snapshot.markedAt.replace(/-/g, '.')} · {snapshot.markedBy} 留版</small>
                    </div>
                  {/each}
                </div>
              {/if}
            </section>

            <!-- 第三层：版片版本 → 修版记录 -->
            <section class="trace-step">
              <h3><span class="step-no">叁</span>版片版本与修版沿革</h3>
              {#if !batch}
                <div class="trace-gap">断点：批次缺失，无法定位版片。</div>
              {:else}
                {@const traceBlocks = $blockStore.filter((block) => block.draftId === sale.draftId)}
                <div class="lineage-grid">
                  {#each traceBlocks as block}
                    {@const versions = versionsFor(block.id)}
                    {@const fixedSnapshot = batch.blockSnapshots?.find((snapshot) => snapshot.blockId === block.id)}
                    <div class="lineage-block">
                      <header>
                        <b>{block.colorNo}. {block.blockName}</b>
                        {#if fixedSnapshot}
                          <span class="fixed-mark">本批用第{cnNumeral(fixedSnapshot.versionNo)}版</span>
                        {:else}
                          <span class="gap-tag">本批无快照</span>
                        {/if}
                      </header>
                      {#if versions.length === 0}
                        <p class="trace-gap small">旧档无留版记录。</p>
                      {:else}
                        <ol class="version-timeline">
                          {#each versions as version}
                            {@const isFixed = fixedSnapshot?.versionId === version.id}
                            {@const isNewer = fixedSnapshot ? version.versionNo > fixedSnapshot.versionNo : false}
                            <li class:fixed={isFixed} class:newer={isNewer} class:legacy={version.legacy}>
                              <span class="tag version-kind kind-{version.kind}">第{cnNumeral(version.versionNo)}版 · {version.kind}</span>
                              <p>{version.versionNote}</p>
                              <small>
                                {version.markedAt.replace(/-/g, '.')} · {version.markedBy}
                                {#if isFixed}<em class="mark-fixed">← 本批固定</em>{/if}
                                {#if isNewer}<em class="mark-newer">返修后新版，旧批不改</em>{/if}
                                {#if version.legacy}<em class="mark-legacy">旧档补建</em>{/if}
                              </small>
                            </li>
                          {/each}
                        </ol>
                      {/if}
                      <a class="mini-link" use:link href={`/drafts/${sale.draftId}/blocks`}>前往版片编排台</a>
                    </div>
                  {/each}
                </div>
              {/if}
            </section>
          </div>
        {/if}
      </article>
    {/each}
  </section>
{/if}
