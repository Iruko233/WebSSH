<template>
  <el-dialog
    v-model="visible"
    :title="$t('security.title') || '安全与加密'"
    width="500px"
    class="security-dialog"
    destroy-on-close
  >
    <el-alert
      :title="$t('security.warning') || '修改这些设置会导致金库被重新加密，所有其他设备将被登出。'"
      type="warning"
      show-icon
      :closable="false"
      class="warning-alert"
    />

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
                  <el-input-number v-model="customParams.iterations" :min="1" :step="kdfForm.algorithm === 'argon2id' ? 1 : 100000" class="full-width" controls-position="right" />
                </el-form-item>
                <template v-if="kdfForm.algorithm === 'argon2id'">
                  <el-form-item :label="$t('setup.memoryKiB') || '内存消耗 (KiB)'">
                    <el-input-number v-model="customParams.memory" :min="1024" :step="1024" class="full-width" controls-position="right" />
                  </el-form-item>
                  <el-form-item :label="$t('setup.parallelism') || '并行度'">
                    <el-input-number v-model="customParams.parallelism" :min="1" :step="1" class="full-width" controls-position="right" />
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
    </el-tabs>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
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

const { t } = useI18n()
const authStore = useAuthStore()

const activeTab = ref('password')
const isLoading = ref(false)

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

const currentAlgoPresets = computed(() => KDF_ALGORITHMS[kdfForm.value.algorithm].presets)
const customParams = ref<KdfParams>({ ...currentAlgoPresets.value['custom'].params })

watch(() => kdfForm.value.algorithm, (newAlgo) => {
  customParams.value = { ...KDF_ALGORITHMS[newAlgo].presets['custom'].params }
})

// Reset forms when dialog opens
watch(visible, (newVal) => {
  if (newVal) {
    pwdForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
    kdfForm.value.currentPassword = ''
    pwdError.value = ''
    kdfError.value = ''
    isLoading.value = false
  }
})

const handlePasswordSubmit = async () => {
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
  try {
    // Changing password keeps current KDF params
    if (!authStore.vaultKdfParams) throw new Error('Missing current KDF params')
    
    await authStore.rekey(
      pwdForm.value.currentPassword,
      pwdForm.value.newPassword,
      authStore.vaultKdfParams
    )
    
    ElMessage.success(t('security.rekeySuccess') || '金库重加密成功！')
    visible.value = false
  } catch (err: any) {
    pwdError.value = err.message || '重加密失败'
  } finally {
    isLoading.value = false
  }
}

const handleKdfSubmit = async () => {
  kdfError.value = ''
  if (!kdfForm.value.currentPassword) {
    kdfError.value = t('security.pwdRequired') || '请填写当前主密码'
    return
  }

  isLoading.value = true
  try {
    let paramsToUse = currentAlgoPresets.value[kdfForm.value.preset].params
    if (kdfForm.value.preset === 'custom') {
      paramsToUse = { ...customParams.value, algorithm: kdfForm.value.algorithm }
    }

    // Changing KDF keeps current password
    await authStore.rekey(
      kdfForm.value.currentPassword,
      kdfForm.value.currentPassword,
      paramsToUse
    )
    
    ElMessage.success(t('security.rekeySuccess') || '金库重加密成功！')
    visible.value = false
  } catch (err: any) {
    kdfError.value = err.message || '重加密失败'
  } finally {
    isLoading.value = false
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
