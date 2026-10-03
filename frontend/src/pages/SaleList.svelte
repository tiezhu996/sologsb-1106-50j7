<script lang="ts">
  import { onMount } from 'svelte'
  import { link } from 'svelte-spa-router'
  import EmptyBox from '../components/common/EmptyBox.svelte'
  import { draftStore } from '../stores/draftStore'
  import { saleStore } from '../stores/saleStore'
  import { db } from '../utils/db'
  import type { PrintBatch } from '../types/batch'
  import type { Sale } from '../types/sale'

  let batches = $state<PrintBatch[]>([])
  let showForm = $state(false)
  let artworkNo = $state('')
  let batchId = $state('')
  let soldAt = $state(new Date().toISOString().slice(0, 10))
  let buyer = $state('')
  let channel = $state('')
  let formMessage = $state('')
  let returningId = $state('')
  let returnNote = $state('')
  let recheckingId = $state('')
  let recheckNote = $state('')

  const activeCount = $derived($saleStore.filter((sale) => sale.status === '有效').length)
  const returnedCount = $derived($saleStore.filter((sale) => sale.status === '退货待复检').length)
  const recheckedCount = $derived($saleStore.filter((sale) => sale.status === '已复检').length)

  const batchById = $derived(new Map(batches.map((batch) => [batch.id, batch])))

  onMount(() => {
    void Promise.all([draftStore.load(), saleStore.load(), refreshBatches()])
  })

  async function refreshBatches(): Promise<void> {
    const records = await db.batches.toArray()
    records.sort((a, b) => b.printedAt.localeCompare(a.printedAt) || b.batchNo.localeCompare(a.batchNo, 'zh-CN'))
    batches = records
  }

  function draftTitle(targetId: string): string {
    return $draftStore.find((draft) => draft.id === targetId)?.title ?? '未知画稿'
  }

  function batchLabel(batch: PrintBatch | undefined): string {
    if (!batch) return '批次已缺失'
    return `${batch.batchNo} · ${draftTitle(batch.draftId)}`
  }

  function openForm(): void {
    showForm = true
    formMessage = ''
    if (!batchId && batches[0]) batchId = batches[0].id
  }

  async function submitSale(): Promise<void> {
    const result = await saleStore.register({ artworkNo, batchId, soldAt, buyer, channel })
    formMessage = result.message
    if (!result.ok) return
    artworkNo = ''
    buyer = ''
    channel = ''
    showForm = false
  }

  function startReturn(sale: Sale): void {
    returningId = sale.id
    recheckingId = ''
    returnNote = ''
  }

  async function confirmReturn(): Promise<void> {
    await saleStore.markReturned(returningId, returnNote)
    returningId = ''
    returnNote = ''
  }

  function startRecheck(sale: Sale): void {
    recheckingId = sale.id
    returningId = ''
    recheckNote = ''
  }

  async function confirmRecheck(): Promise<void> {
    await saleStore.markRechecked(recheckingId, recheckNote)
    recheckingId = ''
    recheckNote = ''
  }
</script>

<svelte:head>
  <title>售出登记 · 木版年画刻版工序档案</title>
</svelte:head>

<div class="page-heading">
  <div>
    <p class="eyebrow">作品与批次绑定</p>
    <h1>售出登记</h1>
    <p>按作品编号绑定印制批次，同一作品只留一条有效售出；退货保留原关联并待复检。</p>
  </div>
  <button class="button primary" data-testid="new-sale" type="button" onclick={openForm}>登记售出</button>
</div>

<section class="summary-strip four">
  <div><span>有效售出</span><strong data-testid="count-sale-active">{activeCount}</strong></div>
  <div><span>退货待复检</span><strong data-testid="count-sale-returned">{returnedCount}</strong></div>
  <div><span>已复检</span><strong>{recheckedCount}</strong></div>
  <div><span>涉及批次</span><strong>{new Set($saleStore.map((sale) => sale.batchId)).size}</strong></div>
</section>

{#if showForm}
  <section class="panel form-panel" data-testid="form-sale">
    <div class="panel-heading">
      <div>
        <span class="section-kicker">新售出</span>
        <h2>作品编号绑定印制批次</h2>
      </div>
      <button class="text-button" type="button" onclick={() => (showForm = false)}>收起</button>
    </div>

    <div class="form-grid three">
      <label>
        <span>作品编号</span>
        <input data-testid="field-artworkNo" bind:value={artworkNo} placeholder="如：LLY-0004" />
      </label>
      <label>
        <span>绑定印制批次</span>
        <select data-testid="field-batchId" bind:value={batchId}>
          <option value="">请选择</option>
          {#each batches as batch (batch.id)}
            <option value={batch.id}>{batchLabel(batch)} · {batch.printedAt}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>售出日期</span>
        <input data-testid="field-soldAt" type="date" bind:value={soldAt} />
      </label>
      <label>
        <span>买家</span>
        <input data-testid="field-buyer" bind:value={buyer} placeholder="画铺、裱画社或藏家" />
      </label>
      <label>
        <span>售出渠道</span>
        <input data-testid="field-channel" bind:value={channel} placeholder="门市 / 订货 / 展销" />
      </label>
    </div>

    {#if formMessage}<p class="form-message" data-testid="sale-message">{formMessage}</p>{/if}
    <div class="form-actions">
      <button class="button primary" data-testid="submit-sale" type="button" onclick={submitSale}>保存售出</button>
      <button class="button ghost" type="button" onclick={() => (showForm = false)}>取消</button>
    </div>
  </section>
{/if}

{#if $saleStore.length === 0}
  <EmptyBox
    title="尚无售出记录"
    message="登记售出时按作品编号绑定印制批次，之后可按作品追溯版片版本。"
    actionLabel="登记售出"
    onaction={openForm}
  />
{:else}
  <section class="sale-list">
    {#each $saleStore as sale (sale.id)}
      {@const batch = batchById.get(sale.batchId)}
      <article class="panel sale-item" data-testid="row-sale">
        <div class="sale-head">
          <div>
            <span class="sale-no">{sale.artworkNo}</span>
            <h2>{batchLabel(batch)}</h2>
            <p>{sale.soldAt.replace(/-/g, '.')} 售出 · {sale.buyer} · {sale.channel}</p>
          </div>
          <span class="tag state-{sale.status}">{sale.status}</span>
        </div>

        {#if sale.status !== '有效'}
          <p class="sale-note"><b>退货留档：</b>{sale.returnedAt?.replace(/-/g, '.')} · {sale.returnNote}</p>
        {/if}
        {#if sale.status === '已复检'}
          <p class="sale-note"><b>复检结论：</b>{sale.recheckedAt?.replace(/-/g, '.')} · {sale.recheckNote}</p>
        {/if}

        {#if returningId === sale.id}
          <div class="inline-form">
            <label class="stacked-field">
              <span>退货原因（保留原批次关联，转入待复检）</span>
              <textarea data-testid="field-returnNote" rows="2" bind:value={returnNote} placeholder="如：买家反映画面套色错位"></textarea>
            </label>
            <div class="inline-actions">
              <button class="button danger" data-testid="confirm-return" type="button" onclick={confirmReturn}>确认退货</button>
              <button class="button ghost" type="button" onclick={() => (returningId = '')}>取消</button>
            </div>
          </div>
        {:else if recheckingId === sale.id}
          <div class="inline-form">
            <label class="stacked-field">
              <span>复检结论</span>
              <textarea data-testid="field-recheckNote" rows="2" bind:value={recheckNote} placeholder="对照批次版本快照复检套色情况"></textarea>
            </label>
            <div class="inline-actions">
              <button class="button primary" data-testid="confirm-recheck" type="button" onclick={confirmRecheck}>登记复检</button>
              <button class="button ghost" type="button" onclick={() => (recheckingId = '')}>取消</button>
            </div>
          </div>
        {:else}
          <div class="inline-actions">
            {#if sale.status === '有效'}
              <button class="mini-button" data-testid={`return-${sale.id}`} type="button" onclick={() => startReturn(sale)}>退货登记</button>
            {/if}
            {#if sale.status === '退货待复检'}
              <button class="mini-button strong" data-testid={`recheck-${sale.id}`} type="button" onclick={() => startRecheck(sale)}>复检登记</button>
            {/if}
            <a class="mini-button trace-link" use:link href={`/trace/${sale.artworkNo}`}>追溯版本</a>
          </div>
        {/if}
      </article>
    {/each}
  </section>
{/if}
