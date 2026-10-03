import DraftList from '../pages/DraftList.svelte'
import BlockBoard from '../pages/BlockBoard.svelte'
import NodeTimeline from '../pages/NodeTimeline.svelte'
import BatchList from '../pages/BatchList.svelte'
import SaleList from '../pages/SaleList.svelte'
import TracePage from '../pages/TracePage.svelte'
import CarverList from '../pages/CarverList.svelte'

export const routes = {
  '/drafts': DraftList,
  '/drafts/:id/blocks': BlockBoard,
  '/blocks/:id/nodes': NodeTimeline,
  '/batches': BatchList,
  '/sales': SaleList,
  '/trace': TracePage,
  '/trace/:artworkNo': TracePage,
  '/carvers': CarverList,
  '*': DraftList,
}

export default routes
