<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { get } from 'svelte/store'
  import { link, params } from 'svelte-spa-router'
  import ColorSwatch from '../components/common/ColorSwatch.svelte'
  import EmptyBox from '../components/common/EmptyBox.svelte'
  import SeqInput from '../components/common/SeqInput.svelte'
  import StageRail from '../components/common/StageRail.svelte'
  import { blockStore } from '../stores/blockStore'
  import { carverStore } from '../stores/carverStore'
  import { draftStore } from '../stores/draftStore'
  import { useBlockOrder } from '../hooks/useBlockOrder'
  import { useCarverLoad } from '../hooks/useCarverLoad'
  import { validateColorSequence } from '../utils/seq'
  import { findAffectedSales, type AffectedSale } from '../utils/trace'
  import { db } from '../utils/db'
  import { blockVersionStore } from '../stores/blockVersionStore'
  import { saleStore } from '../stores/saleStore'
  import type { Block } from '../types/block'
  import type { ProcessStage } from '../types/node'
  import type { BlockVersion } from '../types/blockVersion'

  const draftId = $derived($params?.id ?? '')
  const {
    blocks: orderedBlocks,
    carvedRate: blockCarvedRate,
    reorder: reorderBlocks,
    setDraft: setBlockDraft,
  } = useBlockOrder(draftId)
  const { activeCount: selectedActiveCount, averageDuration: selectedAverageDuration, refresh: refreshCarverLoad } = useCarverLoad('')

  let sequenceDraft = $state<Record<string, number>>({})
  let defectDraft = $state<Record<string, string>>({})
  let selectedCarverId = $state('')
  let notice = $state('')
  let lastSync = $state('刚刚')

  // 返修留新版
  let repairingBlockId = $state<string | null>(null)
  let repairNote = $state('')
  let repairOperator = $state('')
  let repairAffected = $state<AffectedSale[]>([])
  let repairLoading = $state(false)

  const draft = $derived($draftStore.find((item) => item.id === draftId) ?? null)

  onMount(() => {
    void Promise.all([
      draftStore.load(),
      blockStore.load(),
      carverStore.load(),
      blockVersionStore.load(),
      saleStore.load(),
    ])
  })

  const versionsByBlock = $derived.by(() => {
    const map = new Map<string, BlockVersion[]>()
    for (const version of $blockVersionStore) {
      const list = map.get(version.blockId) ?? []
      list.push(version)
      map.set(version.blockId, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.versionNo - b.versionNo)
    return map
  })

  function versionsOf(blockId: string): BlockVersion[] {
    return versionsByBlock.get(blockId) ?? []
  }

  function latestVersionOf(blockId: string): BlockVersion | null {
    const versions = versionsOf(blockId)
    return versions[versions.length - 1] ?? null
  }

  const cnNumerals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  function versionLabel(version: BlockVersion): string {
    return `第${cnNumerals[version.versionNo - 1] ?? version.versionNo}版`
  }

  $effect(() => {
    setBlockDraft(draftId)
  })

  $effect(() => {
    for (const block of $orderedBlocks) {
      if (sequenceDraft[block.id] === undefined) sequenceDraft[block.id] = block.colorNo
      if (defectDraft[block.id] === undefined) defectDraft[block.id] = block.defectNote
    }
  })

  $effect(() => {
    const firstCarver = $carverStore[0]
    if (!selectedCarverId && firstCarver) {
      selectedCarverId = firstCarver.id
      void refreshCarverLoad(firstCarver.id)
    }
  })

  function blockStateStage(state: Block['state']): number {
    if (state === '待刻' || state === '在刻') return 3
    return 4
  }

  function occupiedNumbers(exceptId: string): number[] {
    return $orderedBlocks.filter((block) => block.id !== exceptId).map((block) => block.colorNo)
  }

  async function assignCarver(block: Block, carverName: string): Promise<void> {
    const carver = $carverStore.find((item) => item.name === carverName)
    if (!carver) return
    await carverStore.assignBlock(block, carver.id)
    await blockStore.load()
    lastSync = `已把${block.blockName}指派给刻工`
  }

  async function markCarved(block: Block): Promise<void> {
    await blockStore.update(block.id, { state: '已刻成' })
    await carverStore.releaseBlock(block.id)
    const currentBlocks = get(blockStore).filter((item) => item.draftId === draftId)
    const allCarved = currentBlocks.every((item) => item.state === '已刻成' || item.state === '已修版')
    await draftStore.update(draftId, { status: allCarved ? '可印' : '刻版中' })

    // 标刻成即留下首版版本，之后批次只认留档版本。
    await blockVersionStore.ensureCarvedVersion({
      blockId: block.id,
      draftId: block.draftId,
      markedBy: block.carvedBy || '当班刻工',
      versionNote: defectDraft[block.id]?.trim() || '验线后标刻成，留首版。',
    })

    const existing = await db.nodes.where('blockId').equals(block.id).toArray()
    await db.nodes.add({
      id: `node-${crypto.randomUUID()}`,
      blockId: block.id,
      stage: '刻版',
      seq: Math.max(0, ...existing.map((node) => node.seq)) + 1,
      operator: block.carvedBy || '当班刻工',
      startedAt: new Date().toISOString().slice(0, 16),
      durationMin: 0,
      note: '版片验线后标记刻成，并留首版版本。',
    })
    lastSync = `${block.blockName}已标记刻成并留版`
  }

  const repairingBlock = $derived(
    repairingBlockId ? $orderedBlocks.find((block) => block.id === repairingBlockId) ?? null : null,
  )

  async function openRepair(block: Block): Promise<void> {
    repairingBlockId = block.id
    repairLoading = true
    repairNote = ''
    const latest = latestVersionOf(block.id)
    const nextVersionNo = (latest?.versionNo ?? 0) + 1
    repairOperator = latest?.markedBy || block.carvedBy || '秦木生'
    try {
      const [sales, batches] = await Promise.all([
        saleStore.load().then(() => get(saleStore)),
        db.batches.toArray(),
      ])
      repairAffected = findAffectedSales(block.id, nextVersionNo, { sales, batches })
    } finally {
      repairLoading = false
    }
  }

  function closeRepair(): void {
    repairingBlockId = null
    repairNote = ''
    repairAffected = []
  }

  async function submitRepair(): Promise<void> {
    const block = repairingBlock
    if (!block) return
    if (!repairNote.trim()) {
      notice = '请先填写本次返修说明，再留新版。'
      return
    }

    const version = await blockVersionStore.createRepairVersion({
      blockId: block.id,
      draftId: block.draftId,
      markedBy: repairOperator.trim() || block.carvedBy || '修版师傅',
      versionNote: repairNote.trim(),
    })
    await blockStore.update(block.id, {
      state: '已修版',
      defectNote: repairNote.trim(),
    })

    // 同步记一条修版工序节点
    const existing = await db.nodes.where('blockId').equals(block.id).toArray()
    await db.nodes.add({
      id: `node-${crypto.randomUUID()}`,
      blockId: block.id,
      stage: '修版',
      seq: Math.max(0, ...existing.map((node) => node.seq)) + 1,
      operator: version.markedBy,
      startedAt: new Date().toISOString().slice(0, 16),
      durationMin: 0,
      note: `返修后留第${version.versionNo}版：${version.versionNote}`,
    })

    const affectedCount = repairAffected.length
    closeRepair()
    notice =
      affectedCount > 0
        ? `${block.blockName}已留第${version.versionNo}版；旧批次不改版，共 ${affectedCount} 件已售作品仍固定旧版，待通知复检。`
        : `${block.blockName}已留第${version.versionNo}版；暂无受影响的已售作品。`
    lastSync = `返修留版完成 · 第${version.versionNo}版`
  }

  async function saveSequence(block: Block): Promise<void> {
    const next = sequenceDraft[block.id] ?? block.colorNo
    const check = validateColorSequence([...occupiedNumbers(block.id), next])
    if (!check.valid) {
      notice = check.duplicates.length
        ? `色序 ${check.duplicates.join('、')} 已占用，请调换后再存。`
        : `当前色序有跳号，缺少 ${check.gaps.join('、')}。`
      return
    }

    await blockStore.update(block.id, { colorNo: next })
    notice = `${block.blockName}色序已改为 ${next}`
    lastSync = '套色序号已存档'
    await tick()
  }

  async function moveBlock(block: Block, direction: -1 | 1): Promise<void> {
    const ordered = [...$orderedBlocks]
    const index = ordered.findIndex((item) => item.id === block.id)
    const target = ordered[index + direction]
    if (index < 0 || !target) return

    const moved = [...ordered]
    moved[index] = target
    moved[index + direction] = block
    await reorderBlocks(moved.map((item, itemIndex) => ({ id: item.id, colorNo: itemIndex + 1 })))
    moved.forEach((item, itemIndex) => {
      sequenceDraft[item.id] = itemIndex + 1
    })
    lastSync = `${block.blockName}已${direction < 0 ? '前移' : '后移'}`
  }

  async function saveDefect(block: Block): Promise<void> {
    await blockStore.update(block.id, { defectNote: defectDraft[block.id] ?? '' })
    lastSync = `${block.blockName}崩口记录已更新`
  }

  async function returnToStage(_index: number, stage: ProcessStage): Promise<void> {
    const block = $orderedBlocks[0]
    if (!block) return
    if (stage === '刻版' || stage === '修版') {
      await blockStore.update(block.id, { state: stage === '修版' ? '已修版' : '在刻' })
      lastSync = `已将首块版片阶段调至${stage}`
    }
  }

  function chooseCarver(event: Event): void {
    const select = event.currentTarget as HTMLSelectElement
    selectedCarverId = select.value
    void refreshCarverLoad(select.value)
  }
</script>

<svelte:head>
  <title>版片编排台 · 木版年画刻版工序档案</title>
</svelte:head>

{#if !draft}
  <div class="page-heading">
    <div><p class="eyebrow">画稿与分版</p><h1>版片编排台</h1><p>正在读取画稿与版片档案。</p></div>
  </div>
  <EmptyBox title="未找到这张画稿" message="画稿可能尚未载入或档案编号有误。" />
  <a class="button secondary" use:link href="/drafts">返回画稿总览</a>
{:else}
  <div class="page-heading">
    <div>
      <p class="eyebrow">{draft.genre} · {draft.designer}</p>
      <h1>{draft.title}版片编排台</h1>
      <p>{draft.sizeCm} · 按套色序号依次刻制，先墨线后套色。</p>
    </div>
    <a class="button ghost" use:link href="/drafts">返回画稿总览</a>
  </div>

  <section class="summary-strip four">
    <div><span>版片总数</span><strong>{$orderedBlocks.length}</strong></div>
    <div><span>刻成率</span><strong>{$blockCarvedRate}%</strong></div>
    <div><span>在刻版片</span><strong>{$orderedBlocks.filter((block) => block.state === '在刻').length}</strong></div>
    <div><span>需修版片</span><strong>{$orderedBlocks.filter((block) => block.defectNote).length}</strong></div>
  </section>

  <div class="workbench-grid">
    <section class="panel table-panel wide-panel">
      <div class="panel-heading">
        <div>
          <span class="section-kicker">套色序列</span>
          <h2>版片刻制编排</h2>
        </div>
        <span class="sync-note">{lastSync}</span>
      </div>

      {#if $orderedBlocks.length === 0}
        <EmptyBox title="尚未分版" message="先回画稿总览建立画稿，系统会生成四块基础版片。" />
      {:else}
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>色序</th>
                <th>版片</th>
                <th>木料 / 版厚</th>
                <th>刻工指派</th>
                <th>状态</th>
                <th>崩口与修补</th>
              </tr>
            </thead>
            <tbody>
              {#each $orderedBlocks as block, blockIndex (block.id)}
                <tr data-testid="row-block">
                  <td class="sequence-cell">
                    {#if sequenceDraft[block.id] !== undefined}
                      <SeqInput
                        bind:value={sequenceDraft[block.id]}
                        existing={occupiedNumbers(block.id)}
                        label="序号"
                        testid={`field-colorNo-${block.id}`}
                      />
                    {/if}
                    <button class="mini-button" type="button" onclick={() => saveSequence(block)}>存序号</button>
                    <div class="order-buttons">
                      <button type="button" disabled={blockIndex === 0} onclick={() => moveBlock(block, -1)}>上移</button>
                      <button type="button" disabled={blockIndex === $orderedBlocks.length - 1} onclick={() => moveBlock(block, 1)}>下移</button>
                    </div>
                  </td>
                  <td>
                    <ColorSwatch colorNo={block.colorNo} blockName={block.blockName} />
                  </td>
                  <td>
                    <strong>{block.woodType}</strong>
                    <small>{block.thicknessMm} mm</small>
                  </td>
                  <td>
                    <select
                      data-testid={`field-carvedBy-${block.id}`}
                      value={block.carvedBy}
                      onchange={(event) => assignCarver(block, (event.currentTarget as HTMLSelectElement).value)}
                    >
                      <option value="">待指派</option>
                      {#each $carverStore as carver}
                        <option value={carver.name}>{carver.name} · {carver.specialty}</option>
                      {/each}
                    </select>
                  </td>
                  <td>
                    <span class="tag state-{block.state}">{block.state}</span>
                    {#if block.state !== '已刻成' && block.state !== '已修版'}
                      <button class="mini-button strong" type="button" onclick={() => markCarved(block)}>标刻成</button>
                    {:else}
                      {@const latest = latestVersionOf(block.id)}
                      {#if latest}
                        <div class="version-line">
                          <span class="tag version-kind kind-{latest.kind}">
                            {versionLabel(latest)} · {latest.kind}
                          </span>
                          <small>{latest.markedAt.replace(/-/g, '.')} · {latest.markedBy}</small>
                        </div>
                      {:else}
                        <div class="version-line">
                          <span class="tag version-kind legacy">旧档无留版</span>
                        </div>
                      {/if}
                      <button
                        class="mini-button repair"
                        data-testid={`repair-${block.id}`}
                        type="button"
                        onclick={() => openRepair(block)}
                      >
                        返修留新版
                      </button>
                    {/if}
                  </td>
                  <td>
                    <textarea
                      data-testid={`field-defectNote-${block.id}`}
                      rows="2"
                      bind:value={defectDraft[block.id]}
                      placeholder="崩口、补线或嵌木说明"
                    ></textarea>
                    <button class="mini-button" type="button" onclick={() => saveDefect(block)}>存记录</button>
                  </td>
                </tr>
                <tr class="stage-row">
                  <td colspan="6">
                    <StageRail
                      activeIndex={blockStateStage(block.state)}
                      completedCount={block.state === '已刻成' || block.state === '已修版' ? 5 : block.state === '在刻' ? 3 : 1}
                      compact={true}
                      onselect={block.id === $orderedBlocks[0]?.id ? returnToStage : undefined}
                    />
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <aside class="panel side-panel">
      <div class="panel-heading">
        <div>
          <span class="section-kicker">当班安排</span>
          <h2>刻工负荷</h2>
        </div>
      </div>
      <label class="stacked-field">
        <span>选择刻工</span>
        <select value={selectedCarverId} onchange={chooseCarver}>
          {#each $carverStore as carver}<option value={carver.id}>{carver.name} · {carver.skillLevel}</option>{/each}
        </select>
      </label>
      <div class="load-card">
        <span>当前在刻</span>
        <strong>{$selectedActiveCount}</strong>
        <small>版片</small>
      </div>
      <div class="load-card muted">
        <span>节点平均耗时</span>
        <strong>{$selectedAverageDuration}</strong>
        <small>分钟</small>
      </div>
      {#if notice}<p class="notice">{notice}</p>{/if}
      <a class="button secondary full" use:link href="/carvers">查看刻工档与分布</a>
    </aside>
  </div>

  {#if repairingBlock}
    <section class="panel repair-panel" data-testid="repair-panel">
      <div class="panel-heading">
        <div>
          <span class="section-kicker">返修留版</span>
          <h2>{repairingBlock.blockName}返修后留新版</h2>
        </div>
        <button class="text-button" type="button" onclick={closeRepair}>取消返修</button>
      </div>

      <p class="gentle-copy">
        返修将留下第 {versionsOf(repairingBlock.id).length + 1} 版；旧批次固定的版本快照不会改动，
        之后新登记的批次才使用新版。
      </p>

      <div class="form-grid">
        <label>
          <span>修版师傅</span>
          <input data-testid="repair-operator" bind:value={repairOperator} placeholder="执行返修的师傅" />
        </label>
        <label class="wide">
          <span>返修说明（补线、嵌木、定位调整等）</span>
          <textarea data-testid="repair-note" rows="2" bind:value={repairNote} placeholder="如：左肩定位榫修去半线，复核基准边"></textarea>
        </label>
      </div>

      <div class="affected-block">
        <div class="section-title-row">
          <div>
            <span class="section-kicker">受影响已售作品</span>
            <h3>返修前先行核对</h3>
          </div>
          {#if repairLoading}
            <span>正在核对售出记录…</span>
          {:else}
            <span data-testid="affected-count">{repairAffected.length} 件</span>
          {/if}
        </div>

        {#if !repairLoading && repairAffected.length === 0}
          <p class="gentle-copy">没有售出作品固定本版旧版，本次返修不影响在买家手中的年画。</p>
        {:else if !repairLoading}
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>作品编号</th>
                  <th>所在批次</th>
                  <th>批次固定版本</th>
                  <th>去向 / 状态</th>
                  <th>影响判断</th>
                </tr>
              </thead>
              <tbody>
                {#each repairAffected as item}
                  <tr data-testid="affected-row">
                    <td><a class="trace-link" use:link href={`/sales?sale=${item.sale.id}`}>{item.sale.pieceNo}</a></td>
                    <td>{item.batch.batchNo}<small>{item.batch.printedAt.replace(/-/g, '.')}</small></td>
                    <td>
                      {#if item.snapshot}
                        第{cnNumerals[item.snapshot.versionNo - 1] ?? item.snapshot.versionNo}版 · {item.snapshot.kind}
                      {:else}
                        <span class="gap-tag">批次未留该版快照</span>
                      {/if}
                    </td>
                    <td>
                      {item.sale.buyer}
                      <span class="tag sale-status-{item.sale.status === '有效' ? 'active' : 'returned'}">{item.sale.status}</span>
                    </td>
                    <td>
                      {#if item.reason === '固定旧版'}
                        <span class="affect-confirmed">批次固定旧版，售出年画按旧版印出，需通知复检。</span>
                      {:else}
                        <span class="affect-gap">旧批次缺版本快照，无法确认用版，按断点待查。</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <div class="form-actions">
        <button class="button primary" data-testid="submit-repair" type="button" onclick={submitRepair}>
          确认返修并留第 {versionsOf(repairingBlock.id).length + 1} 版
        </button>
        <button class="button ghost" type="button" onclick={closeRepair}>取消</button>
      </div>
    </section>
  {/if}
{/if}
