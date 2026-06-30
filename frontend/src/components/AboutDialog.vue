<template>
  <el-dialog 
    :model-value="modelValue" 
    @update:model-value="$emit('update:modelValue', $event)"
    :title="$t('app.about')" 
    width="720px"
    destroy-on-close
    class="about-dialog"
  >
    <el-scrollbar max-height="70vh" class="dialog-scrollbar">
      <div class="about-main">
        <!-- Architecture Diagram -->
        <section class="diagram-section">
          <SecurityDiagram />
        </section>

        <!-- Security Bounds Text-List -->
        <section class="security-bounds-minimal">
          <h2 class="section-title">{{ $t('setup.secProtectTitle') }}</h2>
          <div class="bounds-list">
            <!-- Protection Item -->
            <div class="bound-item">
              <div class="bound-header">
                <strong>{{ $t('setup.secProtectYes') }}</strong>
              </div>
              <p class="bound-desc">{{ $t('setup.secProtectYesDesc') }}</p>
            </div>

            <!-- Risks Item -->
            <div class="bound-item">
              <div class="bound-header">
                <strong>{{ $t('setup.secProtectNo') }}</strong>
              </div>
              <p class="bound-desc">{{ $t('setup.secProtectNoDesc') }}</p>
            </div>
          </div>
        </section>

        <!-- Minimal Footer -->
        <footer class="about-footer">
          <div class="footer-left">
            <span class="version-text">{{ $t('app.version', { version: currentVersion }) }}</span>
            <span v-if="checkingUpdate" class="update-status">{{ $t('app.checkingUpdate') }}</span>
            <el-tag v-else-if="updateAvailable" type="success" size="small" class="update-tag" effect="light">
              <a href="https://github.com/Iruko233/WebSSH/releases/latest" target="_blank" rel="noopener noreferrer">
                {{ $t('app.newVersion', { version: latestVersion }) }}
              </a>
            </el-tag>
            <span v-else class="update-status">{{ $t('app.latestVersion') }}</span>

            <el-button v-if="releaseNotes && !checkingUpdate" link type="primary" size="small" style="margin-left: 8px" @click="changelogDialogVisible = true">
              {{ $t('app.viewChangelog') }}
            </el-button>
          </div>

          <a href="https://github.com/Iruko233/WebSSH" target="_blank" rel="noopener noreferrer" class="minimal-github-link">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            GitHub
          </a>
        </footer>
      </div>
    </el-scrollbar>

    <!-- Changelog Inner Dialog -->
    <el-dialog
      v-model="changelogDialogVisible"
      :title="$t('app.releaseNotes')"
      width="600px"
      append-to-body
      destroy-on-close
      class="changelog-dialog"
    >
      <el-scrollbar max-height="50vh">
        <div class="markdown-body" v-html="releaseNotes"></div>
      </el-scrollbar>
    </el-dialog>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import SecurityDiagram from './SecurityDiagram.vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const currentVersion = __APP_VERSION__ || '1.0.0'
const latestVersion = ref('')
const updateAvailable = ref(false)
const checkingUpdate = ref(false)
const releaseNotes = ref('')
const changelogDialogVisible = ref(false)
let checked = false

const checkUpdate = async () => {
  if (checked) return
  checkingUpdate.value = true
  try {
    const res = await fetch('https://api.github.com/repos/Iruko233/WebSSH/releases/latest')
    if (res.ok) {
      const data = await res.json()
      latestVersion.value = data.tag_name || ''
      if (data.body) {
        releaseNotes.value = DOMPurify.sanitize(await marked.parse(data.body))
      }
      const stripV = (v: string) => v.replace(/^v/, '')
      if (latestVersion.value && stripV(latestVersion.value) !== stripV(currentVersion)) {
         updateAvailable.value = true
      }
      checked = true
    }
  } catch (e) {
    // Ignore error
  } finally {
    checkingUpdate.value = false
  }
}

watch(() => props.modelValue, (newVal) => {
  if (newVal) {
    checkUpdate()
  }
})
</script>

<style scoped>
.about-dialog :deep(.el-dialog__body) {
  padding: 0 20px 20px 20px;
}

.dialog-scrollbar {
  padding-right: 12px;
}

.about-main {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.diagram-section {
  width: 100%;
  margin-bottom: 32px;
}

.security-bounds-minimal {
  width: 100%;
  margin-bottom: 24px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 16px 0;
  color: var(--text-primary);
}

.bounds-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.bound-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bound-header {
  display: flex;
  align-items: center;
}

.bound-header strong {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.bound-desc {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0;
  white-space: pre-line;
}

.about-footer {
  padding: 16px 20px;
  margin-top: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid var(--border-color);
  background-color: var(--el-bg-color-page);
  border-radius: var(--radius-sm);
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.version-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  font-family: var(--font-mono);
}

.update-status {
  font-size: 12px;
  color: var(--text-secondary);
}

.update-tag a {
  text-decoration: none;
  color: inherit;
  display: flex;
  align-items: center;
  font-weight: 600;
}

.minimal-github-link {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  text-decoration: none;
  transition: color 0.2s;
}

.minimal-github-link:hover {
  color: var(--text-primary);
}

.changelog-dialog :deep(.el-dialog__body) {
  padding: 10px 20px 20px 20px;
}

.markdown-body {
  font-family: var(--font-primary);
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
}
.markdown-body h1, .markdown-body h2, .markdown-body h3 {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
}
.markdown-body h1 { font-size: 1.8em; border-bottom: 1px solid var(--border-color); padding-bottom: .3em; }
.markdown-body h2 { font-size: 1.4em; border-bottom: 1px solid var(--border-color); padding-bottom: .3em; }
.markdown-body h3 { font-size: 1.2em; }
.markdown-body ul, .markdown-body ol {
  padding-left: 2em;
  margin-top: 0;
  margin-bottom: 16px;
}
.markdown-body li {
  margin-top: 0.25em;
}
.markdown-body code {
  padding: .2em .4em;
  margin: 0;
  font-size: 85%;
  background-color: var(--el-fill-color-light);
  border-radius: 6px;
  font-family: var(--font-mono);
}
.markdown-body pre {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background-color: var(--el-fill-color-light);
  border-radius: 6px;
  margin-top: 0;
  margin-bottom: 16px;
}
.markdown-body pre code {
  background-color: transparent;
  padding: 0;
}
.markdown-body p {
  margin-top: 0;
  margin-bottom: 16px;
}
.markdown-body a {
  color: var(--el-color-primary);
  text-decoration: none;
}
.markdown-body a:hover {
  text-decoration: underline;
}
</style>
