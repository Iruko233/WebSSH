<template>
  <el-dialog 
    :model-value="modelValue" 
    @update:model-value="$emit('update:modelValue', $event)"
    :title="$t('settings.title')" 
    width="480px"
    destroy-on-close
    class="settings-dialog"
  >
    <el-scrollbar max-height="65vh" class="dialog-scrollbar">
      <el-form label-position="top" class="settings-form">
        <div class="settings-section">
          <h3 class="section-title">{{ $t('settings.appAppearance') }}</h3>
          
          <el-form-item :label="$t('settings.appTheme')">
            <el-radio-group v-model="localSettings.appTheme" @change="saveSettings" size="large" class="full-width radio-group-flex">
              <el-radio-button label="light">{{ $t('settings.themeLight') }}</el-radio-button>
              <el-radio-button label="auto">{{ $t('settings.themeAuto') }}</el-radio-button>
              <el-radio-button label="dark">{{ $t('settings.themeDark') }}</el-radio-button>
            </el-radio-group>
          </el-form-item>

          <el-form-item :label="$t('settings.primaryColor')">
            <div class="theme-swatches">
              <button
                v-for="preset in themePresets"
                :key="preset.color"
                class="swatch-btn"
                :class="{ 'is-active': localSettings.primaryColor === preset.color }"
                :style="{ backgroundColor: preset.color }"
                :title="preset.name"
                @click.prevent="selectPreset(preset.color)"
              >
                <el-icon v-if="localSettings.primaryColor === preset.color" class="check-icon"><Check /></el-icon>
              </button>
            </div>
          </el-form-item>
        </div>

        <div class="settings-section">
          <h3 class="section-title">{{ $t('settings.terminalAppearance') }}</h3>

          <el-form-item :label="$t('settings.sftpLayout') || 'SFTP 面板位置'">
            <el-radio-group v-model="localSettings.sftpLayout" @change="saveSettings" size="large" class="full-width radio-group-flex">
              <el-radio-button label="right">{{ $t('settings.sftpLayoutRight') || '右侧 (Right)' }}</el-radio-button>
              <el-radio-button label="bottom">{{ $t('settings.sftpLayoutBottom') || '底部 (Bottom)' }}</el-radio-button>
            </el-radio-group>
          </el-form-item>
        
        <el-form-item :label="$t('settings.fontFamily')">
          <el-select v-model="localSettings.fontFamily" @change="saveSettings" size="large" class="full-width">
            <el-option label="JetBrains Mono" value='"JetBrains Mono", Consolas, "Courier New", monospace' />
            <el-option label="Fira Code" value='"Fira Code", Consolas, "Courier New", monospace' />
            <el-option label="Consolas" value='Consolas, "Courier New", monospace' />
            <el-option label="System Monospace" value='ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' />
          </el-select>
        </el-form-item>

        <el-form-item :label="$t('settings.fontSize')">
          <div class="slider-wrapper">
            <el-slider 
              v-model="localSettings.fontSize" 
              :min="10" 
              :max="24" 
              :step="1"
              @change="saveSettings"
              show-input
            />
          </div>
        </el-form-item>

        <el-form-item :label="$t('settings.padding') || '终端内边距 (Padding)'">
          <div class="slider-wrapper">
            <el-slider 
              v-model="localSettings.padding" 
              :min="0" 
              :max="32" 
              :step="2"
              @change="saveSettings"
              show-input
            />
          </div>
        </el-form-item>

        <el-form-item :label="$t('settings.theme')">
          <el-select v-model="localSettings.theme" @change="saveSettings" size="large" class="full-width">
            <el-option 
              v-for="(theme, key) in THEMES" 
              :key="key" 
              :label="theme.name" 
              :value="key" 
            />
          </el-select>
        </el-form-item>

        </div>

        <div class="settings-section">
          <div class="section-header">
            <h3 class="section-title no-border">{{ $t('settings.keywordHighlight') }}</h3>
            <el-switch v-model="localSettings.keywordHighlight" @change="saveSettings" />
          </div>
          <div class="setting-desc section-desc">{{ $t('settings.keywordHighlightDesc') }}</div>

          <el-collapse-transition>
            <div v-show="localSettings.keywordHighlight" class="keyword-grid">
              <el-checkbox v-model="localSettings.kwError" @change="saveSettings" border class="kw-checkbox kw-error">Error / Fatal</el-checkbox>
              <el-checkbox v-model="localSettings.kwWarning" @change="saveSettings" border class="kw-checkbox kw-warning">Warning</el-checkbox>
              <el-checkbox v-model="localSettings.kwOk" @change="saveSettings" border class="kw-checkbox kw-ok">OK / Success</el-checkbox>
              <el-checkbox v-model="localSettings.kwInfo" @change="saveSettings" border class="kw-checkbox kw-info">Info</el-checkbox>
              <el-checkbox v-model="localSettings.kwDebug" @change="saveSettings" border class="kw-checkbox kw-debug">Debug</el-checkbox>
              <el-checkbox v-model="localSettings.kwIpMac" @change="saveSettings" border class="kw-checkbox kw-ip">IP / MAC</el-checkbox>
            </div>
          </el-collapse-transition>
        </div>

        <div class="settings-section">
          <div class="section-header">
            <h3 class="section-title no-border">{{ $t('settings.autoOpenMonitor') || '就绪时自动打开监控' }}</h3>
            <el-switch v-model="localSettings.autoOpenMonitor" @change="saveSettings" />
          </div>
          <div class="setting-desc section-desc">{{ $t('settings.autoOpenMonitorDesc') || '当服务器状态就绪时，自动弹出监控面板' }}</div>

          <el-form-item :label="$t('settings.monitorInterval') || '监控刷新频率'" class="mt-4">
            <el-radio-group v-model="localSettings.monitorInterval" @change="saveSettings" size="large" class="full-width radio-group-flex">
              <el-radio-button :label="0.5">0.5s</el-radio-button>
              <el-radio-button :label="1">1s</el-radio-button>
              <el-radio-button :label="2">2s</el-radio-button>
              <el-radio-button :label="5">5s</el-radio-button>
            </el-radio-group>
          </el-form-item>
        </div>

        <div class="settings-section">
          <div class="section-header">
            <h3 class="section-title no-border">{{ $t('settings.encryptHandshake') || '加密握手元数据' }}</h3>
            <el-switch v-model="localSettings.encryptHandshake" @change="saveSettings" />
          </div>
          <div class="setting-desc section-desc">{{ $t('settings.encryptHandshakeDesc') || '使用 ECDH + AES-256-GCM 加密 WebSocket 握手中的连接元数据（令牌、主机、端口）。隧道数据已由 SSH 加密保护，不受影响。' }}</div>
        </div>

      </el-form>
    </el-scrollbar>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { THEMES } from '../lib/themes'
import { Check } from '@element-plus/icons-vue'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const settingsStore = useSettingsStore()

// Local copy for reactive two-way binding
const localSettings = ref({
  fontFamily: settingsStore.fontFamily,
  fontSize: settingsStore.fontSize,
  theme: settingsStore.theme,
  padding: settingsStore.padding,
  keywordHighlight: settingsStore.keywordHighlight,
  kwError: settingsStore.kwError,
  kwWarning: settingsStore.kwWarning,
  kwOk: settingsStore.kwOk,
  kwInfo: settingsStore.kwInfo,
  kwDebug: settingsStore.kwDebug,
  kwIpMac: settingsStore.kwIpMac,
  appTheme: settingsStore.appTheme,
  primaryColor: settingsStore.primaryColor,
  sftpLayout: settingsStore.sftpLayout,
  autoOpenMonitor: settingsStore.autoOpenMonitor,
  monitorInterval: settingsStore.monitorInterval,
  encryptHandshake: settingsStore.encryptHandshake
})

const themePresets = [
  { name: 'Indigo (Vercel)', color: '#4f46e5' },
  { name: 'Emerald (Supabase)', color: '#10b981' },
  { name: 'Rose (Figma)', color: '#e11d48' },
  { name: 'Amber (AWS)', color: '#f59e0b' },
  { name: 'Sky (Tailwind)', color: '#0ea5e9' },
  { name: 'Slate (Apple)', color: '#64748b' }
]

const selectPreset = (color: string) => {
  localSettings.value.primaryColor = color
  saveSettings()
}

watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    localSettings.value = {
      fontFamily: settingsStore.fontFamily,
      fontSize: settingsStore.fontSize,
      padding: settingsStore.padding,
      theme: settingsStore.theme,
      keywordHighlight: settingsStore.keywordHighlight,
      kwError: settingsStore.kwError,
      kwWarning: settingsStore.kwWarning,
      kwOk: settingsStore.kwOk,
      kwInfo: settingsStore.kwInfo,
      kwDebug: settingsStore.kwDebug,
      kwIpMac: settingsStore.kwIpMac,
      appTheme: settingsStore.appTheme,
      primaryColor: settingsStore.primaryColor,
      sftpLayout: settingsStore.sftpLayout,
      autoOpenMonitor: settingsStore.autoOpenMonitor,
      monitorInterval: settingsStore.monitorInterval,
      encryptHandshake: settingsStore.encryptHandshake
    }
  }
})

const saveSettings = () => {
  settingsStore.updateSettings(localSettings.value)
}
</script>

<style scoped>
.settings-form {
  padding: 10px 12px; /* 12px padding left/right creates a safe zone for scaled elements so they don't hit the scrollbar's overflow clip */
}

.settings-section {
  margin-bottom: 24px;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 0;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 8px;
}

.section-title.no-border {
  border: none;
  padding: 0;
  margin: 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 8px;
  margin-bottom: 8px;
}

.section-desc {
  margin-bottom: 16px;
}

.slider-wrapper {
  width: 100%;
  padding-right: 16px;
}

.full-width {
  width: 100%;
}

.radio-group-flex {
  display: flex;
}
.radio-group-flex :deep(.el-radio-button) {
  flex: 1;
}
.radio-group-flex :deep(.el-radio-button__inner) {
  width: 100%;
}

.theme-swatches {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  padding: 4px 0; /* Vertical breathing room */
}

.swatch-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
  outline: none;
  box-shadow: var(--shadow-sm);
}

.swatch-btn:hover {
  transform: scale(1.15);
  box-shadow: var(--shadow-md);
}

.swatch-btn.is-active {
  transform: scale(1.15);
  box-shadow: 0 0 0 2px var(--bg-primary), 0 0 0 4px var(--color-primary);
}

.check-icon {
  color: #ffffff;
  font-size: 16px;
  font-weight: bold;
}

.dialog-scrollbar {
  padding-right: 12px;
}

.keyword-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.kw-checkbox {
  margin-right: 0 !important;
  width: 100%;
  border-radius: var(--el-border-radius-base);
  transition: all 0.2s ease;
}

/* Custom checkbox colors for each keyword type */
.kw-checkbox.is-checked.kw-error :deep(.el-checkbox__inner) { background-color: #f56c6c; border-color: #f56c6c; }
.kw-checkbox.is-checked.kw-error.is-bordered { border-color: rgba(245, 108, 108, 0.4); background-color: rgba(245, 108, 108, 0.05); }
.kw-checkbox.is-checked.kw-error :deep(.el-checkbox__label) { color: #f56c6c; }

.kw-checkbox.is-checked.kw-warning :deep(.el-checkbox__inner) { background-color: #e6a23c; border-color: #e6a23c; }
.kw-checkbox.is-checked.kw-warning.is-bordered { border-color: rgba(230, 162, 60, 0.4); background-color: rgba(230, 162, 60, 0.05); }
.kw-checkbox.is-checked.kw-warning :deep(.el-checkbox__label) { color: #e6a23c; }

.kw-checkbox.is-checked.kw-ok :deep(.el-checkbox__inner) { background-color: #67c23a; border-color: #67c23a; }
.kw-checkbox.is-checked.kw-ok.is-bordered { border-color: rgba(103, 194, 58, 0.4); background-color: rgba(103, 194, 58, 0.05); }
.kw-checkbox.is-checked.kw-ok :deep(.el-checkbox__label) { color: #67c23a; }

.kw-checkbox.is-checked.kw-info :deep(.el-checkbox__inner) { background-color: #409eff; border-color: #409eff; }
.kw-checkbox.is-checked.kw-info.is-bordered { border-color: rgba(64, 158, 255, 0.4); background-color: rgba(64, 158, 255, 0.05); }
.kw-checkbox.is-checked.kw-info :deep(.el-checkbox__label) { color: #409eff; }

.kw-checkbox.is-checked.kw-debug :deep(.el-checkbox__inner) { background-color: #b39ddb; border-color: #b39ddb; }
.kw-checkbox.is-checked.kw-debug.is-bordered { border-color: rgba(179, 157, 219, 0.4); background-color: rgba(179, 157, 219, 0.05); }
.kw-checkbox.is-checked.kw-debug :deep(.el-checkbox__label) { color: #b39ddb; }

.kw-checkbox.is-checked.kw-ip :deep(.el-checkbox__inner) { background-color: #f48fb1; border-color: #f48fb1; }
</style>
