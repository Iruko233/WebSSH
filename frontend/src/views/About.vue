<template>
  <div class="about-wrapper">
    <div class="about-container">
      <div class="about-header">
        <h1 class="title">{{ $t('app.about') }}</h1>
      </div>

      <SecurityDiagram />

      <div class="sec-bounds">
        <h3 class="bounds-title">{{ $t('setup.secProtectTitle') }}</h3>
        <el-collapse v-model="activeNames">
          <el-collapse-item name="protection">
            <template #title>
              <div class="collapse-title protection">
                <el-icon class="collapse-icon"><CircleCheck /></el-icon>
                <strong>{{ $t('setup.secProtectYes') }}</strong>
              </div>
            </template>
            <p class="collapse-desc">{{ $t('setup.secProtectYesDesc') }}</p>
          </el-collapse-item>
          <el-collapse-item name="risks">
            <template #title>
              <div class="collapse-title risks">
                <el-icon class="collapse-icon"><WarningFilled /></el-icon>
                <strong>{{ $t('setup.secProtectNo') }}</strong>
              </div>
            </template>
            <p class="collapse-desc">{{ $t('setup.secProtectNoDesc') }}</p>
          </el-collapse-item>
        </el-collapse>
      </div>

      <div class="about-footer">
        <el-button size="large" @click="$router.back()">
          <el-icon><ArrowLeft /></el-icon>
          {{ $t('setup.back') }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ArrowLeft, CircleCheck, WarningFilled } from '@element-plus/icons-vue'
import SecurityDiagram from '../components/SecurityDiagram.vue'

const activeNames = ref(['protection', 'risks'])
</script>

<style scoped>
.about-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  padding: 24px;
  background-color: var(--bg-primary);
  color: var(--text-primary);
}

.about-container {
  width: 100%;
  max-width: 680px;
}

.about-header {
  margin-bottom: 24px;
  text-align: center;
}

.title {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 8px;
  color: var(--text-primary);
}

/* Security Bounds — collapse panels */
.sec-bounds {
  margin: 32px 0 16px;
}

.bounds-title {
  font-size: 15px;
  margin: 0 0 16px 0;
  color: var(--text-primary);
  font-weight: 600;
}

.sec-bounds :deep(.el-collapse) {
  border: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sec-bounds :deep(.el-collapse-item) {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-secondary);
  transition: box-shadow 0.2s;
}

.sec-bounds :deep(.el-collapse-item:hover) {
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
}

.sec-bounds :deep(.el-collapse-item__header) {
  height: auto;
  padding: 16px 20px;
  border: none;
  background: transparent;
  font-weight: inherit;
}

.sec-bounds :deep(.el-collapse-item__wrap) {
  border: none;
  background: transparent;
}

.sec-bounds :deep(.el-collapse-item__content) {
  padding: 0 20px 18px 52px;
}

.collapse-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 15px;
}

.collapse-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.collapse-title.protection .collapse-icon {
  color: #22c55e;
}

.collapse-title.risks .collapse-icon {
  color: #f59e0b;
}

.collapse-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
  white-space: pre-line;
}

.about-footer {
  margin-top: 24px;
  display: flex;
  justify-content: center;
}

</style>
