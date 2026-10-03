<script lang="ts">
  import { onMount } from 'svelte'
  import { link, params, push } from 'svelte-spa-router'
  import EmptyBox from '../components/common/EmptyBox.svelte'
  import VersionChip from '../components/common/VersionChip.svelte'
  import { blockStore } from '../stores/blockStore'
  import { draftStore } from '../stores/draftStore'
  import { saleStore } from '../stores/saleStore'
  import { versionStore } from '../stores/versionStore'
  import { hasSnapshotGap } from '../utils/trace'
  import { db } from '../utils/db'
  import type { PrintBatch, BatchBlockVersion } from '../types/batch'
  import type { Sale } from '../types/sale'
  import type { Block } from '../types/block'
  import type { BlockVersion } from '../types/version'

  let batches = $state<PrintBatch[]>([])
  let keyword = $state('')

  const artworkNo = $derived($params?.artworkNo ?? '')
  const knownArtworks = $derived([...new Set($saleStore.map((sale) => sale.artworkNo))].sort())
  const matchedSales = $derived(
    artworkNo
      ? $saleStore
          .filter((sale) => sale.artworkNo === artworkNo)
          .sort((a, b) => b.soldAt.localeCompare(a.soldAt))
      : [],
  )
  const batchById = $derived(new Map(batches.map((batch) => [batch.id, batch])))

  onMount(() => {
    void Promise.all([draftStore.load(), blockStore.load(), saleStore.load(), versionStore.load(), refreshBatches()])
  })

  $effect(() => {
    keyword = artworkNo
  })

  async function refreshBatches(): Promise<void> {
    batches = await db.batches.toArray()
  }

  function draftTitle(targetId: string): string {
    return $draftStore.find((draft) => draft.id === targetId)?.title ?? '未知画稿'
  }

  function search(): void {
    const target = keyword.trim()
    void push(target ? `/trace/${encodeURIComponent(target)}` : '/trace')
  }

  function chainOf(blockId: string): BlockVersion[] {
    return $versionStore
      .filter((version) => version.blockId === blockId)
      .sort((a, b) => a.versionNo - b.versionNo)
  }

  /** 旧批次断点兼容：按画稿取版片，展示现存版本链供比对 */
  function legacyBlocks(batch: PrintBatch): Block[] {
    return $blockStore
      .filter((block) => block.draftId === batch.draftId)
      .sort((a, b) => a.colorNo - b.colorNo)
  }

  function isAfterSnapshot(version: BlockVersion, entry: BatchBlockVersion): boolean {
    return entry.versionNo !== null && version.versionNo > entry.versionNo
  }

  function formatTime(value: string): string {
    return value.replace('T', ' ')
  }
</script>

<svelte:head>
  <title>溯源追查 · 木版年画刻版工序档案</title>
</svelte:head>

<div class="page-heading">
  <div>
    <p class="eyebrow">作品 → 批次 → 版片版本</p>
    <h1>溯源追查</h1>
    <p>按作品编号展开售出记录、印制批次、版片版本快照与修版记录；旧批次缺快照时按断点展示。</p>
  </div>
  <a class="button ghost" use:link href="/sales">返回售出登记</a>
</div>

<section class="filter-bar" aria-label="作品编号追查">
  <label>
    <span>作品编号</span>
    <input
      data-testid="field-trace-keyword"
      bind:value={keyword}
      list="known-artworks"
      placeholder="如：LLY-0002"
      onkeydown={(event) => event.key === 'Enter' && search()}
    />
    <datalist id="known-artworks">
      {#each knownArtworks as item}<option value={item}></option>{/each}
    </datalist>
  </label>
  <button class="button primary" data-testid="submit-trace" type="button" onclick={search}>追查</button>
  <p>在册作品 {knownArtworks.length} 件</p>
</section>

{#if !artworkNo}
  <EmptyBox title="输入作品编号开始追查" message="从售出登记或买家提供的作品编号入手，逐层展开批次与版片版本。" />
{:else if matchedSales.length === 0}
  <EmptyBox title={`未找到作品 ${artworkNo}`} message="作品编号未登记售出，请核对编号或先在售出登记中绑定批次。" />
{:else}
  <div class="trace-stack" data-testid="trace-result">
    <section class="summary-strip four">
      <div><span>作品编号</span><strong>{artworkNo}</strong></div>
      <div><span>售出记录</span><strong>{matchedSales.length}</strong></div>
      <div><span>当前状态</span><strong>{matchedSales.find((sale) => sale.status === '有效') ? '有效' : matchedSales[0]?.status}</strong></div>
      <div><span>涉及批次</span><strong>{new Set(matchedSales.map((sale) => sale.batchId)).size}</strong></div>
    </section>

    {#each matchedSales as sale (sale.id)}
      {@const batch = batchById.get(sale.batchId)}
      <section class="panel trace-sale" data-testid="trace-sale">
        <div class="panel-heading">
          <div>
            <span class="section-kicker">售出记录</span>
            <h2>{sale.soldAt.replace(/-/g, '.')} · {sale.buyer} · {sale.channel}</h2>
          </div>
          <span class="tag state-{sale.status}">{sale.status}</span>
        </div>

        {#if sale.status !== '有效'}
          <p class="sale-note"><b>退货留档：</b>{sale.returnedAt?.replace(/-/g, '.')} · {sale.returnNote}（原批次关联保留）</p>
        {/if}
        {#if sale.status === '已复检'}
          <p class="sale-note"><b>复检结论：</b>{sale.recheckedAt?.replace(/-/g, '.')} · {sale.recheckNote}</p>
        {/if}

        {#if !batch}
          <p class="gap-note"><span class="gap-mark" aria-hidden="true"></span>关联批次已缺失，无法继续展开。</p>
        {:else}
          <div class="trace-batch">
            <div>
              <span class="section-kicker">印制批次</span>
              <h3>{batch.batchNo}</h3>
              <p>{draftTitle(batch.draftId)} · {batch.printedAt.replace(/-/g, '.')} 印制 · 纸 {batch.paperBatch} · 印 {batch.qty} 张</p>
              <p class="gentle-copy">套色检查：{batch.qcNote}</p>
            </div>
          </div>

          {#if hasSnapshotGap(batch)}
            <div class="gap-divider" data-testid="trace-gap">
              <span class="gap-mark" aria-hidden="true"></span>
              <p>
                <b>版本断点：</b>本批登记早于版片版本留档，批次与版片版本之间的联系缺失。
                以下为该画稿版片现存版本链，仅供比对，不能视为本批所用版本。
              </p>
            </div>
            <div class="chain-grid legacy">
              {#each legacyBlocks(batch) as block (block.id)}
                <section class="chain-card">
                  <div class="chain-head">
                    <VersionChip blockName={block.blockName} colorNo={block.colorNo} versionNo={null} broken={true} />
                    <span>色序 {block.colorNo}</span>
                  </div>
                  {@render versionChain(chainOf(block.id), null)}
                </section>
              {/each}
            </div>
          {:else}
            <div class="chain-grid" data-testid="trace-snapshot">
              {#each batch.versionSnapshot ?? [] as entry (entry.blockId)}
                <section class="chain-card">
                  <div class="chain-head">
                    <VersionChip
                      blockName={entry.blockName}
                      colorNo={entry.colorNo}
                      versionNo={entry.versionNo}
                      broken={entry.versionNo === null}
                    />
                    <span>本批留档</span>
                  </div>
                  {#if entry.versionNo === null}
                    <p class="gap-note small">
                      <span class="gap-mark" aria-hidden="true"></span>
                      登记本批时该版片尚未留档，版本断点。
                    </p>
                  {/if}
                  {@render versionChain(chainOf(entry.blockId), entry)}
                </section>
              {/each}
            </div>
          {/if}
        {/if}
      </section>
    {/each}
  </div>
{/if}

{#snippet versionChain(chain: BlockVersion[], entry: BatchBlockVersion | null)}
  {#if chain.length === 0}
    <p class="gentle-copy">该版片尚无版本留档。</p>
  {:else}
    <ol class="version-chain">
      {#each chain as version (version.id)}
        {@const used = entry !== null && version.id === entry.versionId}
        {@const after = entry !== null && isAfterSnapshot(version, entry)}
        <li class:used class:after>
          <div class="chain-title">
            <strong>v{version.versionNo}</strong>
            <span class="tag kind-{version.kind}">{version.kind}</span>
            {#if used}<span class="tag used-tag">本批所用</span>{/if}
            {#if after && version.kind === '修版留档'}<span class="tag repair-tag">印后修版</span>{/if}
          </div>
          <p>{version.note}</p>
          <small>{version.operator} · {formatTime(version.createdAt)}</small>
        </li>
      {/each}
    </ol>
  {/if}
{/snippet}
