<template>
  <el-dialog
    v-model="visible"
    :title="$t('security.title') || '安全与加密'"
    width="500px"
    class="security-dialog"
    destroy-on-close
  >
    <el-alert
      v-if="activeTab !== 'session'"
      :title="$t('security.warning')"
      type="warning"
      show-icon
      :closable="false"
      class="warning-alert"
    />
    <el-alert
      v-if="authStore.cleanupPending"
      :title="$t('vault.cleanupPending')"
      :description="$t('vault.cleanupPendingDetails')"
      type="warning"
      show-icon
      :closable="false"
      class="warning-alert"
    />
    <el-alert v-if="sessionStatusError" :title="sessionStatusError" type="error" show-icon :closable="false" class="error-msg" />

    <el-tabs v-model="activeTab" class="security-tabs">
      <!-- Change Master Password Tab -->
      <el-tab-pane :label="$t('security.changePassword') || '修改主密码'" name="password">
        <el-form novalidate :model="pwdForm" label-position="top" @submit.prevent="handlePasswordSubmit" class="security-form">
          <el-form-item :label="$t('security.currentPassword') || '当前主密码'" required>
            <el-input 
              v-model="pwdForm.currentPassword" 
              type="password" 
              show-password 
            />
          </el-form-item>
          
          <el-form-item :label="$t('security.newPassword') || '新主密码'" required>
            <el-input 
              v-model="pwdForm.newPassword" 
              type="password" 
              show-password 
            />
          </el-form-item>
          
          <el-form-item :label="$t('security.confirmPassword') || '确认新密码'" required>
            <el-input 
              v-model="pwdForm.confirmPassword" 
              type="password" 
              show-password 
            />
          </el-form-item>

          <el-alert v-if="pwdError" :title="pwdError" type="error" show-icon :closable="false" class="error-msg" />

          <el-button 
            type="primary" 
            native-type="submit" 
            class="full-width" 
            :loading="isLoading"
          >
            {{ $t('security.changePassword') || '修改主密码' }}
          </el-button>
        </el-form>
      </el-tab-pane>

      <!-- Change KDF Settings Tab -->
      <el-tab-pane :label="$t('security.changeKdf') || '修改加密参数'" name="kdf">
        <el-form novalidate :model="kdfForm" label-position="top" @submit.prevent="handleKdfSubmit" class="security-form">
          
          <div class="current-settings">
            <div class="settings-title">{{ $t('security.currentSettings') || '当前加密配置' }}</div>
            <div class="settings-item">
              <span class="label">{{ $t('security.algo') || '派生算法' }}</span>
              <span class="value">{{ authStore.vaultKdfAlgo?.toUpperCase() || '未知' }}</span>
            </div>
            <template v-if="authStore.vaultKdfParams?.algorithm === 'argon2id'">
              <div class="settings-item">
                <span class="label">{{ $t('security.iterations') || '迭代次数' }}</span>
                <span class="value">{{ authStore.vaultKdfParams.iterations }}</span>
              </div>
              <div class="settings-item">
                <span class="label">{{ $t('security.memory') || '内存消耗' }}</span>
                <span class="value">{{ authStore.vaultKdfParams.memory }} KiB</span>
              </div>
              <div class="settings-item">
                <span class="label">{{ $t('security.parallelism') || '并行度' }}</span>
                <span class="value">{{ authStore.vaultKdfParams.parallelism }}</span>
              </div>
            </template>
            <template v-else-if="authStore.vaultKdfParams?.algorithm === 'pbkdf2-sha512'">
              <div class="settings-item">
                <span class="label">{{ $t('security.iterations') || '迭代次数' }}</span>
                <span class="value">{{ authStore.vaultKdfParams.iterations }}</span>
              </div>
            </template>
          </div>

          <el-form-item :label="$t('setup.kdfAlgo') || '目标密钥派生算法'">
            <el-select v-model="kdfForm.algorithm" class="full-width">
              <el-option 
                v-for="(config, key) in KDF_ALGORITHMS" 
                :key="key" 
                :label="$t(config.label)" 
                :value="key" 
              />
            </el-select>
            <div class="preset-description">
              {{ KDF_ALGORITHMS[kdfForm.algorithm]?.description ? $t(KDF_ALGORITHMS[kdfForm.algorithm].description) : '' }}
            </div>
          </el-form-item>

          <el-form-item :label="$t('setup.securityPreset') || '安全预设'">
            <el-select v-model="kdfForm.preset" class="full-width">
              <el-option 
                v-for="(presetConfig, key) in currentAlgoPresets" 
                :key="key" 
                :label="$t(presetConfig.label)" 
                :value="key" 
              >
                <span style="float: left">{{ $t(presetConfig.label) }}</span>
                <span style="float: right; color: var(--text-secondary); font-size: 12px"></span>
              </el-option>
            </el-select>
            <div class="preset-description">
              {{ currentAlgoPresets[kdfForm.preset]?.description ? $t(currentAlgoPresets[kdfForm.preset].description) : '' }}
            </div>
          </el-form-item>

          <el-collapse-transition>
            <div v-show="kdfForm.preset === 'custom'" class="custom-params-container">
              <div class="custom-params-grid">
                <el-form-item :label="$t('setup.iterations') || '迭代次数'">
                  <el-input-number v-model="customParams.iterations" :min="1" :max="kdfForm.algorithm === 'argon2id' ? 100 : 10000000" :step="kdfForm.algorithm === 'argon2id' ? 1 : 100000" class="full-width" controls-position="right" />
                </el-form-item>
                <template v-if="kdfForm.algorithm === 'argon2id'">
                  <el-form-item :label="$t('setup.memoryKiB') || '内存消耗 (KiB)'">
                    <el-input-number v-model="customParams.memory" :min="1024" :max="1048576" :step="1024" class="full-width" controls-position="right" />
                  </el-form-item>
                  <el-form-item :label="$t('setup.parallelism') || '并行度'">
                    <el-input-number v-model="customParams.parallelism" :min="1" :max="16" :step="1" class="full-width" controls-position="right" />
                  </el-form-item>
                </template>
              </div>
            </div>
          </el-collapse-transition>

          <el-form-item :label="$t('security.currentPassword') || '验证当前主密码'" required class="mt-4">
            <el-input 
              v-model="kdfForm.currentPassword" 
              type="password" 
              show-password 
            />
          </el-form-item>

          <el-alert v-if="kdfError" :title="kdfError" type="error" show-icon :closable="false" class="error-msg" />

          <el-button 
            type="primary" 
            native-type="submit" 
            class="full-width mt-2" 
            :loading="isLoading"
          >
            {{ $t('security.changeKdf') || '修改加密参数' }}
          </el-button>
        </el-form>
      </el-tab-pane>

      <el-tab-pane :label="$t('vault.sessionSettings')" name="session">
        <div class="remember-setting">
          <span id="remember-session-label">{{ $t('vault.rememberSession') }}</span>
          <el-switch
            :model-value="authStore.rememberSession"
            :loading="rememberBusy"
            :disabled="isLoading"
            aria-labelledby="remember-session-label"
            @change="handleRememberChange"
          />
        </div>
        <p class="preset-description">{{ $t('vault.rememberDefault') }}</p>
        <p class="preset-description">{{ $t('vault.rememberDetails') }}</p>

        <el-form
          v-if="rememberRequested && !authStore.rememberSession"
          novalidate
          label-position="top"
          class="security-form"
          @submit.prevent="enableRememberSession"
        >
          <el-form-item :label="$t('security.currentPassword')" required>
            <el-input
              v-model="rememberPassword"
              type="password"
              autocomplete="current-password"
              show-password
              :disabled="rememberBusy"
            />
          </el-form-item>
          <p class="preset-description">{{ $t('vault.rememberPasswordRequired') }}</p>
          <div class="remember-actions">
            <el-button :disabled="rememberBusy" @click="cancelRememberSession">{{ $t('vault.cancel') }}</el-button>
            <el-button type="primary" native-type="submit" :loading="rememberBusy">{{ $t('vault.enableRemember') }}</el-button>
          </div>
        </el-form>
        <el-alert v-if="rememberError" :title="rememberError" type="error" show-icon :closable="false" class="error-msg mt-4" />
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useAuthStore } from '../stores/auth'
import { getAuthGeneration } from '../lib/auth-session'
import { KDF_ALGORITHMS, type KdfAlgorithm, type EncryptionPreset, type KdfParams } from '../types'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const { t, te } = useI18n()
const authStore = useAuthStore()
const errorMessage = (err: unknown, fallback: string) => {
  const message = err instanceof Error ? err.message : ''
  return message ? (te(message) ? t(message) : message) : t(fallback)
}

const activeTab = ref('password')
const isLoading = ref(false)
const rememberRequested = ref(false)
const rememberPassword = ref('')
const rememberBusy = ref(false)
const rememberError = ref('')
const sessionStatusError = ref('')
let dialogGeneration = 0

// Password Form
const pwdForm = ref({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const pwdError = ref('')

// KDF Form
const kdfForm = ref({
  currentPassword: '',
  algorithm: (authStore.vaultKdfAlgo as KdfAlgorithm) || 'argon2id',
  preset: 'high' as EncryptionPreset,
})
const kdfError = ref('')

onBeforeUnmount(() => {
  dialogGeneration++
  pwdForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
  kdfForm.value.currentPassword = ''
  rememberPassword.value = ''
})

const currentAlgoPresets = computed(() => KDF_ALGORITHMS[kdfForm.value.algorithm].presets)
const customParams = ref<KdfParams>({ ...currentAlgoPresets.value['custom'].params })

watch(() => kdfForm.value.algorithm, (newAlgo) => {
  customParams.value = { ...KDF_ALGORITHMS[newAlgo].presets['custom'].params }
})

// Forget password fields on both open and close, ignore late dialog responses
watch(visible, async (newVal) => {
  const generation = ++dialogGeneration
  const authGeneration = getAuthGeneration()
  pwdForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
  kdfForm.value.currentPassword = ''
  pwdError.value = ''
  kdfError.value = ''
  rememberRequested.value = false
  rememberPassword.value = ''
  rememberError.value = ''
  sessionStatusError.value = ''
  if (newVal) {
    isLoading.value = false
    try {
      await authStore.refreshSessionStatus()
    } catch (err: unknown) {
      if (generation === dialogGeneration && authGeneration === getAuthGeneration()) {
        sessionStatusError.value = errorMessage(err, 'vault.sessionStatusFailed')
      }
    }
  }
}, { immediate: true })

watch(() => authStore.isAuthenticated, (authenticated) => {
  if (!authenticated) visible.value = false
})

const cancelRememberSession = () => {
  rememberRequested.value = false
  rememberPassword.value = ''
  rememberError.value = ''
}

const handleRememberChange = async (enabled: string | number | boolean) => {
  if (rememberBusy.value || isLoading.value) return
  rememberError.value = ''
  if (enabled === true) {
    rememberRequested.value = true
    return
  }
  const generation = dialogGeneration
  const authGeneration = getAuthGeneration()
  rememberBusy.value = true
  try {
    await authStore.setRememberSession(false)
    if (generation === dialogGeneration && authGeneration === getAuthGeneration()) cancelRememberSession()
  } catch (err: unknown) {
    if (generation === dialogGeneration && authGeneration === getAuthGeneration()) {
      rememberError.value = errorMessage(err, 'vault.rememberFailed')
    }
  } finally {
    rememberBusy.value = false
  }
}

const enableRememberSession = async () => {
  if (rememberBusy.value || isLoading.value) return
  rememberError.value = ''
  if (!rememberPassword.value) {
    rememberError.value = t('setup.pwdRequired')
    return
  }
  const generation = dialogGeneration
  const authGeneration = getAuthGeneration()
  rememberBusy.value = true
  try {
    await authStore.setRememberSession(true, rememberPassword.value)
    if (generation === dialogGeneration && authGeneration === getAuthGeneration()) cancelRememberSession()
  } catch (err: unknown) {
    if (generation === dialogGeneration && authGeneration === getAuthGeneration()) {
      rememberError.value = errorMessage(err, 'vault.rememberFailed')
    }
  } finally {
    rememberPassword.value = ''
    rememberBusy.value = false
  }
}

const handlePasswordSubmit = async () => {
  if (isLoading.value || rememberBusy.value) return
  pwdError.value = ''
  if (!pwdForm.value.currentPassword || !pwdForm.value.newPassword || !pwdForm.value.confirmPassword) {
    pwdError.value = t('security.pwdRequired') || '请填写所有密码字段'
    return
  }
  if (pwdForm.value.newPassword !== pwdForm.value.confirmPassword) {
    pwdError.value = t('security.pwdMismatch') || '两次输入的新密码不一致'
    return
  }

  isLoading.value = true
  const generation = dialogGeneration
  const authGeneration = getAuthGeneration()
  const currentPassword = pwdForm.value.currentPassword
  const newPassword = pwdForm.value.newPassword
  try {
    // Changing password keeps current KDF params
    const metadata = await authStore.ensureVaultMetadata()
    if (generation !== dialogGeneration || authGeneration !== getAuthGeneration()) return
    
    await authStore.rekey(
      currentPassword,
      newPassword,
      metadata.kdfParams
    )
    
    if (generation !== dialogGeneration || !authStore.isAuthenticated) return
    ElMessage.success(t('security.rekeySuccess'))
    visible.value = false
  } catch (err: unknown) {
    if (generation === dialogGeneration && authGeneration === getAuthGeneration()) {
      pwdError.value = errorMessage(err, 'vault.saveFailed')
    }
  } finally {
    if (generation === dialogGeneration) {
      isLoading.value = false
      pwdForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
    }
  }
}

const handleKdfSubmit = async () => {
  if (isLoading.value || rememberBusy.value) return
  kdfError.value = ''
  if (!kdfForm.value.currentPassword) {
    kdfError.value = t('security.pwdRequired') || '请填写当前主密码'
    return
  }

  isLoading.value = true
  const generation = dialogGeneration
  const authGeneration = getAuthGeneration()
  const currentPassword = kdfForm.value.currentPassword
  try {
    let paramsToUse = currentAlgoPresets.value[kdfForm.value.preset].params
    if (kdfForm.value.preset === 'custom') {
      paramsToUse = { ...customParams.value, algorithm: kdfForm.value.algorithm }
    }

    // Changing KDF keeps current password
    await authStore.rekey(
      currentPassword,
      currentPassword,
      paramsToUse
    )
    
    if (generation !== dialogGeneration || !authStore.isAuthenticated) return
    ElMessage.success(t('security.rekeySuccess'))
    visible.value = false
  } catch (err: unknown) {
    if (generation === dialogGeneration && authGeneration === getAuthGeneration()) {
      kdfError.value = errorMessage(err, 'vault.saveFailed')
    }
  } finally {
    if (generation === dialogGeneration) {
      isLoading.value = false
      kdfForm.value.currentPassword = ''
    }
  }
}
</script>

<style scoped>
.security-dialog :deep(.el-dialog__body) {
  padding: 10px 20px 20px 20px;
}

.warning-alert {
  margin-bottom: 20px;
  border-radius: var(--radius-md);
}

.security-tabs {
  margin-top: 10px;
}

.security-form {
  padding-top: 10px;
}

.full-width {
  width: 100%;
}

.remember-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 10px;
}

.remember-setting :deep(.el-switch) {
  flex-shrink: 0;
}

.remember-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.remember-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.mt-2 {
  margin-top: 8px;
}

.mt-4 {
  margin-top: 16px;
}

.error-msg {
  margin-bottom: 16px;
  border-radius: var(--radius-md);
}

.current-settings {
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 24px;
  border: 1px solid var(--border-color);
}

.settings-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.settings-item {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 0.875rem;
}

.settings-item:last-child {
  margin-bottom: 0;
}

.settings-item .label {
  color: var(--text-secondary);
}

.settings-item .value {
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  background: rgba(0,0,0,0.05);
  padding: 2px 6px;
  border-radius: 4px;
}

.preset-description {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 8px;
  line-height: 1.4;
}

.custom-params-container {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--border-color);
}

.custom-params-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
</style>
