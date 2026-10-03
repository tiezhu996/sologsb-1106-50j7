<script lang="ts">
  import { onMount } from 'svelte'
  import { link } from 'svelte-spa-router'
  import { blockStore } from '../stores/blockStore'
  import { saleStore } from '../stores/saleStore'
  import { versionStore } from '../stores/versionStore'
  import { findAffectedSales } from '../utils/trace'
  import { db } from '../utils/db'
  import type { Block } from '../types/block'
  import type { PrintBatch } from '../types/batch'
  import type { BlockVersion } from '../types/version'

  interface Props {
    block: Block
    onclose: () => void
    onrepaired: (version: BlockVersion, affectedCount: number) => void
  }

  let { block, onclose, onrepaired }: Props = $props()

  const latestVersions = versionStore.latestByBlock

  let batches = $state<PrintBatch[]>([])
  let operator = $state('')
  let note = $state('')
  let feedback = $state('')
  let busy = $state(false)

  const latestVersion = $derived($latestVersions[block.id] ?? null)
  const nextVersionNo = $derived((latestVersion?.versionNo ?? 0) + 1)
  const affected = $derived(findAffectedSales(block, batches, $saleStore))

  onMount(() => {
    void Promise.all([saleStore.load(), versionStore.load(), refreshBatches()])
  })

  $effect(() => {
    if (!operator) operator = block.carvedBy
  })

  async function refreshBatches(): Promise<void> {
    batches = await db.batches.toArray()
  }

  async function confirmRepair(): Promise<void> {
    if (busy) return
    busy = true

    // 修版只新增版本留档，历史批次的版本快照保持不动
    const version = await versionStore.record(block.id, '修版留档', operator, note)
    await blockStore.update(block.id, { state: '已修版' })

    const existing = await db.nodes.where('blockId').equals(block.id).toArray()
    await db.nodes.add({
      id: `node-${crypto.randomUUID()}`,
      blockId: block.id,
      stage: '修版',
      seq: Math.max(0, ...existing.map((node) => node.seq)) + 1,
      operator: version.operator,
      startedAt: new Date().toISOString().slice(0, 16),
      durationMin: 0,
      note: `修版留档 v${version.versionNo}：${version.note}`,
    })

    feedback = `已留档 v${version.versionNo}，历史批次快照未改动。`
    busy = false
    onrepaired(version, affected.length)
  }
</script>

<section class="panel form-panel repair-panel" data-testid="panel-repair">
  <div class="panel-heading">
    <div>
      <span class="section-kicker">返修留档</span>
      <h2>{block.blockName}修版 · 将留档 v{nextVersionNo}</h2>
    </div>
    <button class="text-button" type="button" onclick={onclose}>收起</button>
  </div>

  <p class="gentle-copy">
    当前留档：{latestVersion ? `v${latestVersion.versionNo} · ${latestVersion.kind} · ${latestVersion.operator}` : '尚未留档（本次为首条版本）'}。
    修版只新增版片版本，不回写历史批次的版本快照。
  </p>

  <div class="form-grid">
    <label>
      <span>修版人</span>
      <input data-testid="field-repair-operator" bind:value={operator} placeholder="修版刻工姓名" />
    </label>
    <label class="wide">
      <span>修版说明</span>
      <textarea data-testid="field-repair-note" rows="2" bind:value={note} placeholder="补线、嵌木或改刀要点"></textarea>
    </label>
  </div>

  <div class="affected-block">
    <div class="section-title-row">
      <div>
        <span class="section-kicker">影响核对</span>
        <h3>受影响的已售作品</h3>
      </div>
      <strong data-testid="count-affected">{affected.length} 件</strong>
    </div>

    {#if affected.length === 0}
      <p class="gentle-copy">按批次版本快照核对，暂无已售作品涉及本版片。</p>
    {:else}
      <ul class="affected-list">
        {#each affected as item (item.sale.id)}
          <li>
            <strong>{item.sale.artworkNo}</strong>
            <span>{item.batch.batchNo} · {item.sale.buyer}</span>
            <span class="tag state-{item.sale.status}">{item.sale.status}</span>
            {#if item.certainty === '存疑'}
              <em class="doubt">批次缺版本快照，按画稿推断</em>
            {/if}
            <a use:link href={`/trace/${item.sale.artworkNo}`}>追溯</a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if feedback}<p class="notice">{feedback}</p>{/if}
  <div class="form-actions">
    <button class="button primary" data-testid="submit-repair" type="button" disabled={busy} onclick={confirmRepair}>
      确认修版并留档 v{nextVersionNo}
    </button>
    <button class="button ghost" type="button" onclick={onclose}>取消</button>
  </div>
</section>

<style>
  .repair-panel {
    margin-bottom: 1.25rem;
  }

  .affected-block {
    margin-top: 1.25rem;
    padding-top: 1.1rem;
    border-top: 1px dashed var(--line-strong);
  }

  .affected-list {
    list-style: none;
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0;
  }

  .affected-list li {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: #fffdf8;
    font-size: 0.82rem;
  }

  .affected-list li > span {
    color: var(--ink-muted);
  }

  .affected-list a {
    margin-left: auto;
    color: var(--cinnabar);
    font-weight: 800;
    text-decoration: none;
  }

  .doubt {
    color: var(--gold);
    font-size: 0.74rem;
    font-style: normal;
  }
</style>
