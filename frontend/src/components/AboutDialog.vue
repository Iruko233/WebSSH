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
          <a href="https://github.com/Iruko233/WebSSH" target="_blank" rel="noopener noreferrer" class="minimal-github-link">
            GitHub
          </a>
        </footer>
      </div>
    </el-scrollbar>
  </el-dialog>
</template>

<script setup lang="ts">
import SecurityDiagram from './SecurityDiagram.vue'

defineProps<{
  modelValue: boolean
}>()

defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()
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
  padding: 16px 0 0 0;
  display: flex;
  justify-content: center;
}

.minimal-github-link {
  font-size: 13px;
  color: var(--text-secondary);
  text-decoration: none;
  transition: color 0.2s;
}

.minimal-github-link:hover {
  color: var(--text-primary);
}
</style>
