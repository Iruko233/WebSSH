<template>
  <div class="vault-setup-wrapper">
    <div v-if="authStore.connectionError" class="vault-container error-state">
      <div class="vault-header">
        <h1 class="title">{{ $t('setup.networkErrorTitle') }}</h1>
        <p class="subtitle text-danger">{{ $t('setup.networkErrorDesc') }}</p>
      </div>
      <el-alert
        :title="authStore.connectionError"
        type="error"
        show-icon
        class="error-alert"
        :closable="false"
      />
      <div class="form-actions">
        <el-button type="primary" size="large" class="submit-btn" :loading="authStore.checkingStatus" @click="retryConnection">
          {{ $t('setup.retryConn') }}
        </el-button>
      </div>
    </div>

    <div v-else class="vault-container">
      <div class="vault-header">
        <h1 class="title">{{ isExistingVault ? $t('setup.welcomeBack') : $t('setup.createVault') }}</h1>
        <p class="subtitle" v-if="isExistingVault">{{ $t('setup.unlockDesc') }}</p>
        <p class="subtitle brief-desc" v-else>{{ $t('setup.briefDesc') }}</p>
      </div>

      <el-form novalidate :model="form" @submit.prevent="handleSubmit" label-position="top" class="vault-form">

        <!-- Step 1: Password (or Unlock) -->
        <div v-show="!showKdfSettings" class="step-content">
          <el-form-item :label="$t('setup.masterPassword')" required>
            <el-input 
              v-model="form.password" 
              type="password" 
              :placeholder="$t('setup.passwordPlaceholder')"
              show-password
              size="large"
              :prefix-icon="Key"
              class="minimal-input"
            />
          </el-form-item>

          <template v-if="!isExistingVault">
            <el-form-item :label="$t('setup.confirmPassword')" required>
              <el-input 
                v-model="form.confirmPassword" 
                type="password" 
                :placeholder="$t('setup.confirmPlaceholder')"
                show-password
                size="large"
                :prefix-icon="Key"
                class="minimal-input"
              />
            </el-form-item>
          </template>

          <div class="remember-session">
            <el-checkbox v-model="rememberSession" :disabled="isLoading">
              {{ $t('vault.rememberSession') }}
            </el-checkbox>
            <p class="remember-description">{{ $t('vault.rememberDefault') }}</p>
            <p v-if="rememberSession" class="remember-description">{{ $t('vault.rememberDetails') }}</p>
          </div>

          <el-alert
            v-if="error && !showKdfSettings"
            :title="error"
            type="error"
            show-icon
            class="error-alert"
            :closable="false"
          />

          <div class="form-actions">
            <el-button 
              v-if="!isExistingVault"
              type="primary" 
              class="submit-btn" 
              size="large"
              @click.prevent="goToKdfSettings"
            >
              {{ $t('setup.nextStep') }}
            </el-button>
            
            <el-button 
              v-else
              type="primary" 
              native-type="submit" 
              class="submit-btn" 
              size="large"
              :loading="isLoading"
            >
              {{ $t('setup.unlockBtn') }}
            </el-button>
          </div>
        </div>

        <!-- Step 2: Advanced Settings (Only for new vaults) -->
        <div v-show="showKdfSettings" class="step-content">
          <div class="settings-header">
            <h3>{{ $t('setup.advancedSettings') }}</h3>
            <p>{{ $t('setup.kdfDesc') }}</p>
          </div>

          <el-form-item :label="$t('setup.kdfAlgo')">
            <el-select v-model="form.algorithm" size="large" class="full-width minimal-input">
              <el-option 
                v-for="(config, key) in KDF_ALGORITHMS" 
                :key="key" 
                :label="$t(config.label)" 
                :value="key" 
              />
            </el-select>
            <div class="preset-description">
              {{ KDF_ALGORITHMS[form.algorithm]?.description ? $t(KDF_ALGORITHMS[form.algorithm].description) : '' }}
            </div>
          </el-form-item>

          <el-form-item :label="$t('setup.securityPreset')">
            <el-select v-model="form.preset" size="large" class="full-width minimal-input">
              <el-option 
                v-for="(presetConfig, key) in currentAlgoPresets" 
                :key="key" 
                :label="$t(presetConfig.label)" 
                :value="key" 
              />
            </el-select>
            <div class="preset-description">
              {{ currentAlgoPresets[form.preset]?.description ? $t(currentAlgoPresets[form.preset].description) : '' }}
            </div>
          </el-form-item>

          <el-collapse-transition>
            <div v-show="form.preset === 'custom'" class="custom-params-container">
              <div class="custom-params-grid">
                <el-form-item :label="$t('setup.iterations')">
                  <el-input-number v-model="customParams.iterations" :min="1" :max="form.algorithm === 'argon2id' ? 100 : 10000000" :step="form.algorithm === 'argon2id' ? 1 : 100000" class="full-width minimal-input" controls-position="right" />
                </el-form-item>
                <template v-if="form.algorithm === 'argon2id'">
                  <el-form-item :label="$t('setup.memoryKiB')">
                    <el-input-number v-model="customParams.memory" :min="1024" :max="1048576" :step="1024" class="full-width minimal-input" controls-position="right" />
                  </el-form-item>
                  <el-form-item :label="$t('setup.parallelism')">
                    <el-input-number v-model="customParams.parallelism" :min="1" :max="16" :step="1" class="full-width minimal-input" controls-position="right" />
                  </el-form-item>
                </template>
              </div>
            </div>
          </el-collapse-transition>

          <el-alert
            v-if="error && showKdfSettings"
            :title="error"
            type="error"
            show-icon
            class="error-alert"
            :closable="false"
          />

          <div class="form-actions dual-actions">
            <el-button size="large" class="back-btn" @click.prevent="showKdfSettings = false">
              {{ $t('setup.back') }}
            </el-button>
            <el-button 
              type="primary" 
              native-type="submit" 
              class="submit-btn" 
              size="large"
              :loading="isLoading"
            >
              {{ $t('setup.initBtn') }}
            </el-button>
          </div>
        </div>

      </el-form>

      <div class="security-badge">
        <el-icon><Lock /></el-icon> {{ $t('setup.securityBadge') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getAuthGeneration } from '../lib/auth-session'
import { KDF_ALGORITHMS, type KdfAlgorithm, type EncryptionPreset, type KdfParams } from '../types'
import { ElMessage } from 'element-plus'
import { Key, Lock } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
const router = useRouter()
const { t, te } = useI18n()
const authStore = useAuthStore()

const isExistingVault = computed(() => authStore.vaultExists)
const showKdfSettings = ref(false)
const rememberSession = ref(false)


const form = ref({
  password: '',
  confirmPassword: '',
  algorithm: 'argon2id' as KdfAlgorithm,
  preset: 'high' as EncryptionPreset,
})

const isLoading = ref(false)
const error = ref('')
let viewActive = true

const errorMessage = (err: unknown) => {
  const message = err instanceof Error ? err.message : ''
  return message ? (te(message) ? t(message) : message) : t('setup.authFailed')
}

onBeforeUnmount(() => {
  viewActive = false
  form.value.password = ''
  form.value.confirmPassword = ''
})

const currentAlgoPresets = computed(() => KDF_ALGORITHMS[form.value.algorithm].presets)

const customParams = ref<KdfParams>({ ...currentAlgoPresets.value['custom'].params })

watch(() => form.value.algorithm, (newAlgo) => {
  customParams.value = { ...KDF_ALGORITHMS[newAlgo].presets['custom'].params }
})

const retryConnection = async () => {
  if (isLoading.value || authStore.checkingStatus) return
  isLoading.value = true
  try {
    await authStore.checkStatus()
  } finally {
    isLoading.value = false
  }
}

const goToKdfSettings = () => {
  error.value = ''
  if (!form.value.password) {
    error.value = t('setup.pwdRequired')
    return
  }
  if (form.value.password !== form.value.confirmPassword) {
    error.value = t('setup.pwdMismatch')
    return
  }
  showKdfSettings.value = true
}

const handleSubmit = async () => {
  if (isLoading.value || authStore.checkingStatus) return
  const generation = getAuthGeneration()
  const isCurrent = () => viewActive && generation === getAuthGeneration()
  error.value = ''
  
  if (!isExistingVault.value && !showKdfSettings.value) {
    goToKdfSettings()
    return
  }

  if (isExistingVault.value) {
    if (!form.value.password) {
      error.value = t('setup.pwdRequired')
      return
    }
    isLoading.value = true
    try {
      await authStore.unlockVault(form.value.password, rememberSession.value)
      if (!isCurrent()) return
      form.value.password = ''
      form.value.confirmPassword = ''
      ElMessage.success(t('setup.unlockSuccess'))
      router.push('/')
    } catch (err: unknown) {
      if (isCurrent()) error.value = errorMessage(err)
    } finally {
      isLoading.value = false
    }
  } else {
    // New vault creation
    isLoading.value = true
    try {
      let paramsToUse = currentAlgoPresets.value[form.value.preset].params
      if (form.value.preset === 'custom') {
        paramsToUse = { ...customParams.value, algorithm: form.value.algorithm }
      }

      await authStore.createVault(form.value.password, paramsToUse, rememberSession.value)
      if (!isCurrent()) return
      form.value.password = ''
      form.value.confirmPassword = ''
      ElMessage.success(t('setup.createSuccess'))
      router.push('/')
    } catch (err: unknown) {
      if (isCurrent()) error.value = errorMessage(err)
    } finally {
      isLoading.value = false
    }
  }
}
</script>

<style scoped>
.vault-setup-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  background-color: var(--bg-primary);
  color: var(--text-primary);
}

.vault-container {
  width: 100%;
  max-width: 400px;
  transition: max-width 0.3s ease;
}

.error-state {
  text-align: center;
}

.text-danger {
  color: var(--el-color-danger) !important;
}

.vault-header {
  margin-bottom: 32px;
  text-align: center;
}

.title {
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 8px;
  color: var(--text-primary);
}

.subtitle {
  font-size: 0.95rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}

.vault-form :deep(.el-form-item__label) {
  font-weight: 500;
  padding-bottom: 8px;
  color: var(--text-primary);
}

/* Minimalist Inputs */
:deep(.minimal-input .el-input__wrapper),
:deep(.minimal-input.el-select .el-input__wrapper),
:deep(.minimal-input.el-input-number .el-input__wrapper) {
  box-shadow: none !important;
  background-color: var(--bg-secondary) !important;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  transition: all 0.2s ease;
}

:deep(.minimal-input .el-input__wrapper:hover),
:deep(.minimal-input.el-select .el-input__wrapper:hover) {
  border-color: var(--text-secondary);
}

:deep(.minimal-input .el-input__wrapper.is-focus),
:deep(.minimal-input.el-select .el-input__wrapper.is-focus) {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary) !important;
}

.full-width {
  width: 100%;
}

.settings-header {
  margin-bottom: 24px;
  text-align: center;
}

.settings-header h3 {
  margin: 0 0 4px 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.settings-header p {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.preset-description {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-top: 8px;
  line-height: 1.4;
}

.remember-session {
  margin-top: 16px;
}

.remember-session :deep(.el-checkbox) {
  /* Loading disables interaction without switching to Element Plus's light disabled palette */
  --el-checkbox-disabled-input-fill: var(--el-checkbox-bg-color);
  --el-checkbox-disabled-border-color: var(--el-border-color);
  --el-checkbox-disabled-checked-input-fill: var(--el-checkbox-checked-bg-color);
  --el-checkbox-disabled-checked-input-border-color: var(--el-checkbox-checked-input-border-color);
  --el-checkbox-disabled-checked-icon-color: var(--el-checkbox-checked-icon-color);
  --el-disabled-text-color: var(--el-checkbox-text-color);
  height: auto;
  align-items: flex-start;
  white-space: normal;
}

.remember-session :deep(.el-checkbox.is-checked) {
  --el-disabled-text-color: var(--el-checkbox-checked-text-color);
}

.remember-session :deep(.el-checkbox__input) {
  margin-top: 3px;
}

.remember-description {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 0.8rem;
  line-height: 1.5;
}

.custom-params-container {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.custom-params-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

.error-alert {
  margin-bottom: 24px;
  border-radius: var(--radius-sm);
}

.form-actions {
  margin-top: 32px;
  display: flex;
  justify-content: flex-end;
}

.dual-actions {
  display: flex;
  gap: 12px;
}

.submit-btn {
  font-size: 1rem !important;
  height: 44px;
  border-radius: var(--radius-md);
  font-weight: 500;
  padding: 0 24px;
}

.back-btn {
  flex: 1;
  font-size: 1rem !important;
  height: 44px;
  border-radius: var(--radius-md);
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.back-btn:hover {
  background: var(--bg-secondary);
  border-color: var(--text-secondary);
  color: var(--text-primary);
}

.security-badge {
  margin-top: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--text-secondary);
  font-weight: 500;
}
</style>
