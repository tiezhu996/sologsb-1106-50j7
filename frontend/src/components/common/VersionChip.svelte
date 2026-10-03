<script lang="ts">
  import type { BlockName } from '../../types/block'

  interface Props {
    blockName: BlockName
    colorNo: number
    versionNo: number | null
    broken?: boolean
  }

  let { blockName, colorNo, versionNo, broken = false }: Props = $props()
</script>

<span class:broken class="version-chip" title={broken ? '版本断点' : `色序 ${colorNo} · ${blockName}`}>
  <i class="dot" aria-hidden="true"></i>
  <span class="name">{blockName}</span>
  {#if versionNo !== null}
    <strong>v{versionNo}</strong>
  {:else}
    <em>未留档</em>
  {/if}
</span>

<style>
  .version-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.22rem 0.55rem;
    background: #fffdf8;
    color: var(--ink-soft);
    font-size: 0.74rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--jade);
  }

  .name {
    color: var(--ink-muted);
    font-weight: 700;
  }

  strong {
    color: var(--ink);
  }

  .broken {
    border-style: dashed;
    border-color: var(--gold);
    background: #fbf3df;
  }

  .broken .dot {
    background: var(--gold);
  }

  em {
    color: var(--gold);
    font-style: normal;
  }
</style>
