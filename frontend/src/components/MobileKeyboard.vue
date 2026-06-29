<template>
  <div class="mobile-keyboard">
    <div class="keyboard-scroll-area">
      <button 
        class="kb-btn mod-btn" 
        :class="{ active: ctrlActive }" 
        @click="$emit('toggle-ctrl')"
      >
        Ctrl
      </button>
      <button 
        class="kb-btn mod-btn" 
        :class="{ active: altActive }" 
        @click="$emit('toggle-alt')"
      >
        Alt
      </button>
      <button class="kb-btn" @click="$emit('input', '\x1b')">Esc</button>
      <button class="kb-btn" @click="$emit('input', '\t')">Tab</button>
      
      <div class="kb-divider"></div>
      
      <button class="kb-btn" @click="$emit('input', getArrowSeq('A'))">
        <el-icon><Top /></el-icon>
      </button>
      <button class="kb-btn" @click="$emit('input', getArrowSeq('B'))">
        <el-icon><Bottom /></el-icon>
      </button>
      <button class="kb-btn" @click="$emit('input', getArrowSeq('D'))">
        <el-icon><Back /></el-icon>
      </button>
      <button class="kb-btn" @click="$emit('input', getArrowSeq('C'))">
        <el-icon><Right /></el-icon>
      </button>

      <div class="kb-divider"></div>
      
      <button class="kb-btn" @click="$emit('input', '/')">/</button>
      <button class="kb-btn" @click="$emit('input', '-')">-</button>
      <button class="kb-btn" @click="$emit('input', '|')">|</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Top, Bottom, Back, Right } from '@element-plus/icons-vue'

const props = defineProps<{
  ctrlActive: boolean
  altActive: boolean
}>()

defineEmits<{
  (e: 'toggle-ctrl'): void
  (e: 'toggle-alt'): void
  (e: 'input', data: string): void
}>()

const getArrowSeq = (direction: 'A' | 'B' | 'C' | 'D') => {
  if (props.ctrlActive && props.altActive) return `\x1b[1;7${direction}`
  if (props.ctrlActive) return `\x1b[1;5${direction}`
  if (props.altActive) return `\x1b[1;3${direction}`
  return `\x1b[${direction}`
}
</script>

<style scoped>
.mobile-keyboard {
  width: 100%;
  height: 44px;
  background-color: var(--term-bg, #1e1e24);
  border-top: 1px solid color-mix(in srgb, var(--term-fg, #abb2bf) 15%, transparent);
  display: flex;
  align-items: center;
  flex-shrink: 0;
  z-index: 100;
}

.keyboard-scroll-area {
  display: flex;
  align-items: center;
  overflow-x: auto;
  gap: 6px;
  padding: 0 8px;
  height: 100%;
  width: 100%;
  /* hide scrollbar */
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.keyboard-scroll-area::-webkit-scrollbar {
  display: none;
}

.kb-btn {
  height: 32px;
  min-width: 40px;
  padding: 0 10px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--term-fg, #abb2bf) 30%, transparent);
  background: color-mix(in srgb, var(--term-bg, #1e1e24) 80%, var(--term-fg, #abb2bf) 20%);
  color: var(--term-fg, #abb2bf);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: all 0.2s;
}

.kb-btn:active {
  background: color-mix(in srgb, var(--term-bg, #1e1e24) 60%, var(--term-fg, #abb2bf) 40%);
  transform: scale(0.95);
}

.kb-btn.mod-btn {
  font-weight: 600;
}

.kb-btn.mod-btn.active {
  background: var(--term-cursor, #528bff);
  color: #fff;
  border-color: var(--term-cursor, #528bff);
}

.kb-divider {
  width: 1px;
  height: 20px;
  background-color: color-mix(in srgb, var(--term-fg, #abb2bf) 20%, transparent);
  flex-shrink: 0;
  margin: 0 2px;
}
</style>
