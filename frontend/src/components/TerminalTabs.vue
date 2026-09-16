<template>
  <div class="terminal-tabs">
    <div ref="tabList" class="tab-list" role="tablist" :aria-label="t('terminal.tabs')"
      @click.capture="suppressDragClick" @scroll="updateDropTarget">
      <div v-for="tab in store.tabs" :key="tab.id" class="tab-item"
        :class="{ active: store.activeTabId === tab.id, dragging: drag?.id === tab.id && drag.started }"
        :data-tab-id="tab.id" @pointerdown="onPointerDown($event, tab.id)">
        <button :id="`label-${tab.id}`" class="tab-select" type="button" role="tab"
          :aria-selected="store.activeTabId === tab.id" :aria-controls="`panel-${tab.id}`"
          :tabindex="store.activeTabId === tab.id ? 0 : -1"
          :title="`${tab.title} — ${t(`terminal.status.${tab.status}`)}`"
          @click="store.setActiveTab(tab.id)" @keydown="onKeydown($event, tab.id)">
          <span class="status-dot" :class="tab.status" aria-hidden="true"></span>
          <span class="tab-title">{{ tab.title }}</span>
          <span class="sr-only">{{ t(`terminal.status.${tab.status}`) }}</span>
        </button>
        <button class="tab-close" type="button" :aria-label="t('terminal.closeTab', { name: tab.title })"
          :title="t('terminal.closeTab', { name: tab.title })" @pointerdown.stop @click.stop="closeTab(tab.id)">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m3 3 6 6m0-6-6 6" /></svg>
        </button>
      </div>
      <span v-if="drag?.started" class="drop-marker" :style="{ left: `${markerLeft}px` }" aria-hidden="true"></span>
    </div>
    <div class="terminal-panels">
      <section v-for="tab in store.tabs" :key="tab.id" v-show="store.activeTabId === tab.id"
        :id="`panel-${tab.id}`" role="tabpanel" :aria-labelledby="`label-${tab.id}`" class="terminal-panel">
        <slot :tab="tab" :active="store.activeTabId === tab.id"></slot>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTerminalStore } from '../stores/terminal'

const store = useTerminalStore()
const { t } = useI18n()
const tabList = ref<HTMLElement | null>(null)
const drag = ref<{ id: string; pointerId: number; startX: number; x: number; started: boolean } | null>(null)
const markerLeft = ref(0)
let beforeId: string | null = null
let animationFrame = 0
let suppressUntil = 0

function tabButtons() {
  return Array.from(tabList.value?.querySelectorAll<HTMLButtonElement>('.tab-select') ?? [])
}

async function revealActive(focus = false) {
  await nextTick()
  const button = tabButtons().find(button => button.getAttribute('aria-selected') === 'true')
  button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  if (focus) button?.focus({ preventScroll: true })
}

function closeTab(id: string) {
  const hadFocus = tabList.value?.contains(document.activeElement)
  store.removeTab(id)
  if (hadFocus) void revealActive(true)
}

function onKeydown(event: KeyboardEvent, id: string) {
  const index = store.tabs.findIndex(tab => tab.id === id)
  let target: number
  switch (event.key) {
    case 'ArrowRight': target = (index + 1) % store.tabs.length; break
    case 'ArrowLeft': target = (index - 1 + store.tabs.length) % store.tabs.length; break
    case 'Home': target = 0; break
    case 'End': target = store.tabs.length - 1; break
    case 'Delete': event.preventDefault(); closeTab(id); return
    default: return
  }
  event.preventDefault()
  const tab = store.tabs[target]
  if (tab) { store.setActiveTab(tab.id); void revealActive(true) }
}

function onPointerDown(event: PointerEvent, id: string) {
  // Touch gestures remain native horizontal scrolling
  if (event.pointerType !== 'mouse' || event.button !== 0) return
  stopDrag()
  suppressUntil = 0
  drag.value = { id, pointerId: event.pointerId, startX: event.clientX, x: event.clientX, started: false }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', cancelDrag)
  window.addEventListener('blur', cancelDrag)
  window.addEventListener('keydown', onDragKeydown)
}

function onPointerMove(event: PointerEvent) {
  if (!drag.value || event.pointerId !== drag.value.pointerId) return
  drag.value.x = event.clientX
  if (!drag.value.started && Math.abs(event.clientX - drag.value.startX) > 6) {
    drag.value.started = true
    store.setActiveTab(drag.value.id)
    animationFrame = requestAnimationFrame(autoScroll)
  }
  if (drag.value.started) { event.preventDefault(); updateDropTarget() }
}

function updateDropTarget() {
  const list = tabList.value
  if (!list || !drag.value?.started) return
  const items = Array.from(list.querySelectorAll<HTMLElement>('.tab-item'))
  const target = items.find(item => {
    const rect = item.getBoundingClientRect()
    return drag.value!.x < rect.left + rect.width / 2
  })
  beforeId = target?.dataset.tabId ?? null
  const listRect = list.getBoundingClientRect()
  const edge = target?.getBoundingClientRect().left ?? items.at(-1)?.getBoundingClientRect().right ?? listRect.left
  markerLeft.value = edge - listRect.left + list.scrollLeft
}

function autoScroll() {
  const list = tabList.value
  if (!list || !drag.value?.started) return
  const rect = list.getBoundingClientRect()
  const x = drag.value.x
  const delta = x < rect.left + 36 ? -10 : x > rect.right - 36 ? 10 : 0
  if (delta) { list.scrollLeft += delta; updateDropTarget() }
  animationFrame = requestAnimationFrame(autoScroll)
}

function onPointerUp(event: PointerEvent) {
  if (!drag.value || event.pointerId !== drag.value.pointerId) return
  if (drag.value.started) {
    updateDropTarget()
    store.moveTab(drag.value.id, beforeId)
    suppressUntil = performance.now() + 400
    void revealActive(true)
  }
  stopDrag()
}

function suppressDragClick(event: MouseEvent) {
  if (performance.now() < suppressUntil) { event.preventDefault(); event.stopPropagation() }
}

function onDragKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); cancelDrag() }
}

function cancelDrag() {
  if (drag.value?.started) suppressUntil = performance.now() + 400
  stopDrag()
}

function stopDrag() {
  cancelAnimationFrame(animationFrame)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', cancelDrag)
  window.removeEventListener('blur', cancelDrag)
  window.removeEventListener('keydown', onDragKeydown)
  drag.value = null
}

watch(() => store.activeTabId, () => { if (!drag.value?.started) void revealActive() })
watch(() => store.tabs.map(tab => tab.id).join(','), () => {
  if (drag.value && !store.tabs.some(tab => tab.id === drag.value!.id)) cancelDrag()
  if (!drag.value?.started) void revealActive()
}, { immediate: true })
onBeforeUnmount(stopDrag)
</script>

<style scoped>
.terminal-tabs { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.tab-list { position: relative; display: flex; flex: 0 0 auto; width: 100%; overflow-x: auto; overflow-y: hidden; background: color-mix(in srgb, var(--bg-primary) 85%, var(--text-primary) 5%); scrollbar-width: thin; touch-action: pan-x; }
.tab-item { display: flex; align-items: center; flex: 1 0 120px; min-width: 120px; max-width: 220px; height: 40px; padding-right: 8px; border-right: 1px solid var(--border-color); border-bottom: 2px solid transparent; color: var(--text-secondary); user-select: none; transition: background-color .15s, color .15s; }
.tab-item:hover { background: color-mix(in srgb, var(--text-primary) 5%, transparent); }
.tab-item.active { color: var(--color-primary); background: var(--bg-secondary); border-bottom-color: var(--color-primary); }
.tab-item.dragging { opacity: .5; cursor: grabbing; }
.tab-select { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; align-self: stretch; padding: 0 12px; border: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
.tab-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-close { display: flex; align-items: center; justify-content: center; flex: 0 0 24px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--text-secondary); cursor: pointer; }
.tab-close:hover { background: color-mix(in srgb, var(--text-primary) 12%, transparent); color: var(--text-primary); }
.tab-close svg { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
.tab-select:focus-visible, .tab-close:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.status-dot { flex: 0 0 8px; width: 8px; height: 8px; border-radius: 50%; background: var(--text-secondary); }
.status-dot.connecting, .status-dot.awaiting-input { background: var(--el-color-warning); }
.status-dot.connecting { animation: connecting-pulse 1.4s ease-in-out infinite; }
.status-dot.connected { background: var(--el-color-success); }
.status-dot.error { background: var(--el-color-danger); }
.drop-marker { position: absolute; top: 3px; bottom: 3px; width: 3px; border-radius: 2px; background: var(--color-primary); pointer-events: none; z-index: 2; }
.terminal-panels { flex: 1; min-height: 0; position: relative; overflow: hidden; }
.terminal-panel { width: 100%; height: 100%; overflow: hidden; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@keyframes connecting-pulse { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .status-dot.connecting { animation: none; } .tab-item { transition: none; } }
</style>
