<template>
  <div class="security-diagram-wrapper" :class="{ 'is-loading': isLoading }">
    <div v-if="isLoading" class="loading-state">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span class="loading-text">{{ $t('setup.loadingDiagram', '加载架构图中...') }}</span>
    </div>
    <div ref="mermaidWrapper" class="mermaid-pan-wrapper">
      <div ref="mermaidContainer" class="mermaid-container"></div>
    </div>
    
    <!-- Controls overlay -->
    <div v-if="!isLoading" class="zoom-controls">
      <el-button-group>
        <el-button :icon="ZoomIn" @click="zoomIn" circle />
        <el-button :icon="Refresh" @click="resetZoom" circle />
        <el-button :icon="ZoomOut" @click="zoomOut" circle />
      </el-button-group>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, computed, onBeforeUnmount } from 'vue'
import { useDark } from '@vueuse/core'
import { Loading, ZoomIn, ZoomOut, Refresh } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import panzoom, { type PanZoom } from 'panzoom'

const { t } = useI18n()
const isDark = useDark()
const mermaidContainer = ref<HTMLElement | null>(null)
const isLoading = ref(true)
let mermaidInstance: any = null
let pzInstance: PanZoom | null = null

const graphDefinition = computed(() => {
  return `
flowchart LR
    subgraph Browser ["${t('setup.secBrowser')}"]
        direction TB
        B1("${t('setup.secBrowserItem1')}")
        B2("${t('setup.secBrowserItem2')}")
        B3("${t('setup.secBrowserItem3')}")
        B1 ~~~ B2 ~~~ B3
    end

    subgraph Server ["${t('setup.secBackend')}"]
        direction TB
        S2("${t('setup.secBackendItem3')}")
        S1("${t('setup.secBackendItem1')}")
        S2 ~~~ S1
    end

    subgraph Target ["${t('setup.secTarget')}"]
        T1(("${t('setup.secTarget')}"))
    end

    Browser -- "1. ${t('setup.secFlow1Title')}\\n(${t('setup.secFlow1Desc')})" --> Server
    Browser == "2. ${t('setup.secFlow2Title')}\\n(${t('setup.secFlow2Desc')})" ==> Server
    Server == "3. ${t('setup.secFlow3Title')}\\n(${t('setup.secFlow3Desc')})" ==> Target

    %% Styling
    classDef safe fill:#10b981,stroke:#047857,stroke-width:2px,color:#fff;


    class S1,S2 safe;

    linkStyle 0 stroke:#10b981,stroke-width:2px;
    linkStyle 1 stroke:#3b82f6,stroke-width:2px;
    linkStyle 2 stroke:#3b82f6,stroke-width:2px;
`
})

async function renderDiagram() {
  if (!mermaidContainer.value) return
  
  try {
    if (!mermaidInstance) {
      const mermaidModule = await import('mermaid')
      mermaidInstance = mermaidModule.default
    }

    mermaidInstance.initialize({
      startOnLoad: false,
      theme: isDark.value ? 'dark' : 'default',
      securityLevel: 'loose',
      fontFamily: 'var(--font-sans)',
      flowchart: {
        htmlLabels: true,
        curve: 'basis',
        padding: 20
      }
    })

    const { svg } = await mermaidInstance.render('securityGraph', graphDefinition.value)
    
    if (mermaidContainer.value) {
      mermaidContainer.value.innerHTML = svg
      initPanZoom()
    }
  } catch (e) {
    console.error('Failed to render mermaid diagram', e)
  } finally {
    isLoading.value = false
  }
}

function initPanZoom() {
  if (pzInstance) {
    pzInstance.dispose()
  }
  
  if (mermaidContainer.value) {
    const svgEl = mermaidContainer.value.querySelector('svg')
    if (svgEl) {
      pzInstance = panzoom(svgEl, {
        maxZoom: 5,
        minZoom: 0.3,
        bounds: true,
        boundsPadding: 0.1,
        smoothScroll: false
      })
    }
  }
}

function zoomIn() {
  if (pzInstance && mermaidContainer.value) {
    const rect = mermaidContainer.value.getBoundingClientRect()
    pzInstance.smoothZoom(rect.width / 2, rect.height / 2, 1.5)
  }
}

function zoomOut() {
  if (pzInstance && mermaidContainer.value) {
    const rect = mermaidContainer.value.getBoundingClientRect()
    pzInstance.smoothZoom(rect.width / 2, rect.height / 2, 0.6)
  }
}

function resetZoom() {
  if (pzInstance) {
    pzInstance.moveTo(0, 0)
    pzInstance.zoomAbs(0, 0, 1)
  }
}

onMounted(() => {
  renderDiagram()
})

onBeforeUnmount(() => {
  if (pzInstance) {
    pzInstance.dispose()
  }
})

watch([isDark, () => graphDefinition.value], () => {
  nextTick(() => {
    renderDiagram()
  })
})
</script>

<style scoped>
.security-diagram-wrapper {
  position: relative;
  width: 100%;
  min-height: 450px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 16px 0;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  overflow: hidden;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 14px;
}

.mermaid-pan-wrapper {
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mermaid-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
}

.mermaid-container:active {
  cursor: grabbing;
}

.zoom-controls {
  position: absolute;
  bottom: 16px;
  right: 16px;
  z-index: 10;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  border-radius: var(--radius-lg);
}

.mermaid-container :deep(svg) {
  max-width: 100%;
  height: auto;
  transform-origin: center center;
}
</style>
