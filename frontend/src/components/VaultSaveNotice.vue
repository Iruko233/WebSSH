<template>
  <section v-if="needsAttention" class="vault-save-notice" aria-live="polite">
    <el-alert
      :title="message"
      :type="vaultRepository.status.phase === 'conflict' ? 'warning' : 'error'"
      :closable="false"
      show-icon
    >
      <div class="notice-actions">
        <el-button size="small" :loading="busy" @click="reviewChanges">
          {{ $t(vaultRepository.status.phase === 'conflict' ? 'vault.reviewChanges' : 'vault.checkLatest') }}
        </el-button>
      </div>
    </el-alert>
  </section>

  <el-dialog
    v-model="reviewVisible"
    :title="$t('vault.conflictTitle')"
    width="min(640px, calc(100vw - 32px))"
    append-to-body
    destroy-on-close
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
  >
    <p class="review-description">{{ $t('vault.conflictDetails') }}</p>
    <p class="review-hint">{{ $t('vault.valuesHidden') }}</p>

    <div class="changes-list">
      <article v-for="(change, index) in changes" :key="`${change.kind}-${change.id || index}`" class="change-card">
        <div class="change-heading">
          <strong>{{ $t(change.kind === 'settings' ? 'settings.title' : 'vault.serverRecord') }}</strong>
          <span v-if="change.serverLabel || change.id" class="record-id">{{ change.serverLabel || $t('vault.record', { id: change.id }) }}</span>
        </div>
        <div class="change-comparison">
          <div>
            <span class="comparison-label">{{ $t('vault.localChanges') }}</span>
            <p class="change-action">{{ $t(`vault.actions.${change.localAction}`) }}</p>
            <p>{{ change.fields.length ? describeFields(change.fields, change.kind) : $t('vault.noLocalChanges') }}</p>
          </div>
          <div :class="{ 'remote-conflict': change.remoteChanged }">
            <span class="comparison-label">{{ $t('vault.remoteChanges') }}</span>
            <p class="change-action">{{ $t(`vault.actions.${change.remoteAction}`) }}</p>
            <p>{{ describeRemote(change) }}</p>
          </div>
        </div>
      </article>
      <p v-if="changes.length === 0" class="review-hint">{{ $t('vault.noChanges') }}</p>
    </div>

    <el-alert v-if="actionError" :title="actionError" type="error" show-icon :closable="false" class="action-error" />
    <p class="review-hint">{{ $t('vault.discardDetails') }}</p>
    <template #footer>
      <div class="review-actions">
        <el-button :disabled="busy" @click="reviewVisible = false">{{ $t('vault.cancel') }}</el-button>
        <el-button :disabled="busy" @click="useServerVersion">{{ $t('vault.useServerVersion') }}</el-button>
        <el-button type="primary" :loading="busy" :disabled="!vaultRepository.status.hasUnsavedChanges" @click="confirmChanges">
          {{ $t('vault.confirmDraft') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { vaultRepository } from '../lib/vault-repository'
import { useAuthStore } from '../stores/auth'

type ConflictChange = ReturnType<typeof vaultRepository.getConflictChanges>[number]

const { t, te } = useI18n()
const authStore = useAuthStore()
const reviewVisible = ref(false)
const running = ref(false)
const actionError = ref('')
const changes = ref<ConflictChange[]>([])
let reviewGeneration = 0

const busy = computed(() => running.value || vaultRepository.status.resolving)
const needsAttention = computed(() => authStore.isAuthenticated && ['conflict', 'error'].includes(vaultRepository.status.phase))
const localizeError = (error: unknown) => {
  const value = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return value ? (te(value) ? t(value) : value) : t('vault.saveFailed')
}
const message = computed(() => localizeError(vaultRepository.status.error || (vaultRepository.status.phase === 'conflict' ? 'vault.conflict' : 'vault.saveFailed')))

const serverFields: Record<string, string> = {
  name: 'serverForm.serverAlias',
  host: 'serverForm.host',
  port: 'serverForm.port',
  username: 'serverForm.username',
  password: 'serverForm.password',
  group: 'serverForm.group',
  tags: 'serverForm.tags',
  expectedHostKey: 'serverForm.knownHostKey',
  os: 'vault.operatingSystem',
  createdAt: 'vault.createdAt',
  updatedAt: 'vault.updatedAt',
}

function describeFields(fields: string[], kind: ConflictChange['kind']) {
  if (!fields.length) return t('vault.allFields')
  return fields.map((field) => {
    const key = kind === 'settings' ? `settings.${field}` : serverFields[field]
    return key && te(key) ? t(key) : field
  }).join(' · ')
}

function describeRemote(change: ConflictChange) {
  if (!change.remoteChanged) return t('vault.noRemoteChanges')
  return change.remoteFields.length ? describeFields(change.remoteFields, change.kind) : t('vault.remoteRecordChanged')
}

watch(() => [vaultRepository.status.phase, vaultRepository.status.hasUnsavedChanges, vaultRepository.status.resolving] as const, ([phase, unsaved, resolving]) => {
  if (phase === 'locked' || phase === 'rekeying' || (phase === 'ready' && !unsaved && !resolving)) {
    reviewGeneration++
    reviewVisible.value = false
    changes.value = []
    actionError.value = ''
  }
})

async function reviewChanges() {
  if (busy.value) return
  const generation = ++reviewGeneration
  running.value = true
  actionError.value = ''
  try {
    await vaultRepository.refreshConflict()
    if (generation !== reviewGeneration || !needsAttention.value) return
    changes.value = vaultRepository.getConflictChanges()
    reviewVisible.value = true
  } catch (error: unknown) {
    if (generation !== reviewGeneration || !needsAttention.value) return
    actionError.value = localizeError(error)
  } finally {
    running.value = false
  }
}

async function confirmChanges() {
  if (busy.value || !changes.value.length) return
  const generation = reviewGeneration
  running.value = true
  actionError.value = ''
  try {
    await vaultRepository.confirmDraft()
    if (generation === reviewGeneration) reviewVisible.value = false
  } catch (error: unknown) {
    if (generation !== reviewGeneration || !needsAttention.value) return
    changes.value = vaultRepository.getConflictChanges()
    actionError.value = localizeError(error)
  } finally {
    running.value = false
  }
}

async function useServerVersion() {
  if (busy.value) return
  const generation = reviewGeneration
  running.value = true
  actionError.value = ''
  try {
    await vaultRepository.discardDraftAndReload()
    if (generation === reviewGeneration) reviewVisible.value = false
  } catch (error: unknown) {
    if (generation !== reviewGeneration || !needsAttention.value) return
    actionError.value = localizeError(error)
  } finally {
    running.value = false
  }
}
</script>

<style scoped>
.vault-save-notice {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1999;
  width: min(640px, calc(100vw - 32px));
  box-shadow: 0 4px 20px rgb(0 0 0 / 12%);
}

.notice-actions {
  margin-top: 8px;
}

.review-description,
.review-hint {
  line-height: 1.5;
  margin: 0 0 12px;
}

.review-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.changes-list {
  max-height: 45vh;
  overflow-y: auto;
}

.change-card {
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-md, 8px);
}

.change-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin-bottom: 10px;
}

.record-id {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.change-comparison {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.comparison-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.change-comparison p {
  line-height: 1.5;
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}

.remote-conflict p {
  color: var(--el-color-warning);
}

.change-action {
  font-weight: 500;
}

.review-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.review-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.action-error {
  margin: 12px 0;
}
</style>
