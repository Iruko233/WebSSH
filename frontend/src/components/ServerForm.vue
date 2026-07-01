<template>
  <el-form 
    :model="form" 
    @submit.prevent="handleSubmit" 
    label-position="top"
    class="server-form"
  >
    <div class="form-row">
      <el-form-item :label="$t('serverForm.serverAlias')" class="flex-2">
        <el-input 
          v-model="form.name" 
          :placeholder="$t('serverForm.aliasPlaceholder')" 
          size="large"
        />
      </el-form-item>

      <el-form-item :label="$t('serverForm.group')" class="flex-1">
        <el-autocomplete
          v-model="form.group"
          :fetch-suggestions="querySearchGroup"
          :placeholder="$t('serverForm.groupPlaceholder')"
          size="large"
          class="full-width"
        />
      </el-form-item>
    </div>
    
    <div class="form-row">
      <el-form-item :label="$t('serverForm.tags') || 'Tags'" class="full-width">
        <el-select
          v-model="form.tags"
          multiple
          filterable
          allow-create
          default-first-option
          :reserve-keyword="false"
          :placeholder="$t('serverForm.tagsPlaceholder') || 'e.g. prod, web, us-east'"
          size="large"
          class="full-width"
        >
          <el-option
            v-for="tag in serverStore.availableTags"
            :key="tag"
            :label="tag"
            :value="tag"
          />
        </el-select>
      </el-form-item>
    </div>
    
    <div class="form-row">
      <el-form-item :label="$t('serverForm.host')" required class="flex-2">
        <el-input 
          v-model="form.host" 
          :placeholder="$t('serverForm.hostPlaceholder')" 
          size="large"
        />
      </el-form-item>
      <el-form-item :label="$t('serverForm.port')" class="flex-1">
        <el-input-number 
          v-model="form.port" 
          :min="1" 
          :max="65535" 
          size="large"
          class="full-width"
          :controls="false"
        />
      </el-form-item>
    </div>
    
    <el-form-item :label="$t('serverForm.username')" required>
      <el-input 
        v-model="form.username" 
        :placeholder="$t('serverForm.userPlaceholder')" 
        size="large"
      />
    </el-form-item>
    
    <el-form-item :label="$t('serverForm.password')">
      <el-input 
        v-model="form.password" 
        type="password" 
        show-password 
        :placeholder="$t('serverForm.pwdPlaceholder')" 
        size="large"
      />
    </el-form-item>

    <div v-if="form.expectedHostKey" class="host-key-section">
      <div class="host-key-header">
        <span>{{ $t('serverForm.knownHostKey') }}</span>
        <el-button type="danger" link @click="form.expectedHostKey = undefined" size="small">
          {{ $t('serverForm.clearHostKey') }}
        </el-button>
      </div>
      <div class="host-key-code">
        <code>{{ form.expectedHostKey }}</code>
      </div>
      <div class="host-key-help">{{ $t('serverForm.hostKeyHelp') }}</div>
    </div>
    
    <div class="dialog-footer">
      <el-button @click="$emit('cancel')" size="large" class="cancel-btn">{{ $t('serverForm.cancel') }}</el-button>
      <el-button type="primary" native-type="submit" :loading="isLoading" size="large" class="submit-btn">
        {{ server ? $t('serverForm.save') : $t('serverForm.add') }}
      </el-button>
    </div>
  </el-form>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useServerStore, type DecryptedServer } from '../stores/server'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  server?: DecryptedServer | null
}>()

const emit = defineEmits<{
  (e: 'success'): void
  (e: 'cancel'): void
}>()

const serverStore = useServerStore()
const { t } = useI18n()
const isLoading = ref(false)

const form = ref<{
  name: string
  group: string
  tags: string[]
  host: string
  port: number
  username: string
  password: string
  expectedHostKey?: string
}>({
  name: '',
  group: '',
  tags: [],
  host: '',
  port: 22,
  username: '',
  password: '',
  expectedHostKey: undefined
})

const querySearchGroup = (queryString: string, cb: any) => {
  const groups = serverStore.availableGroups
  const results = queryString
    ? groups.filter(g => g.toLowerCase().includes(queryString.toLowerCase())).map(value => ({ value }))
    : groups.map(value => ({ value }))
  cb(results)
}

// Initialize form when editing
watch(() => props.server, (newServer) => {
  if (newServer) {
    form.value = {
      name: newServer.name,
      group: newServer.credentials.group || '',
      tags: newServer.credentials.tags ? [...newServer.credentials.tags] : [],
      host: newServer.credentials.host,
      port: newServer.credentials.port || 22,
      username: newServer.credentials.username,
      password: newServer.credentials.password,
      expectedHostKey: newServer.credentials.expectedHostKey
    }
  } else {
    // Reset form
    form.value = {
      name: '',
      group: '',
      tags: [],
      host: '',
      port: 22,
      username: '',
      password: '',
      expectedHostKey: undefined
    }
  }
}, { immediate: true })

const handleSubmit = async () => {
  if (!form.value.host || !form.value.username) {
    ElMessage.error(t('serverForm.fillRequired'))
    return
  }

  const finalName = form.value.name.trim() || form.value.host.trim()
  const finalPort = form.value.port || 22

  isLoading.value = true
  try {
    const credentials = {
      group: form.value.group || undefined,
      tags: form.value.tags.length > 0 ? [...form.value.tags] : undefined,
      host: form.value.host,
      port: finalPort,
      username: form.value.username,
      password: form.value.password,
      expectedHostKey: form.value.expectedHostKey
    }

    if (props.server) {
      await serverStore.updateServer(props.server.id, finalName, credentials)
      ElMessage.success(t('serverForm.updateSuccess'))
    } else {
      await serverStore.addServer(finalName, credentials)
      ElMessage.success(t('serverForm.addSuccess'))
    }
    emit('success')
  } catch (err: any) {
    ElMessage.error(err.message || t('serverForm.saveFailed'))
  } finally {
    isLoading.value = false
  }
}
</script>

<style scoped>
.server-form :deep(.el-form-item__label) {
  font-weight: 500;
  color: var(--text-primary);
  padding-bottom: 6px;
}

.form-row {
  display: flex;
  gap: 16px;
}

.flex-2 {
  flex: 2;
}

.flex-1 {
  flex: 1;
}

.full-width {
  width: 100%;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--border-color);
}

.cancel-btn, .submit-btn {
  border-radius: var(--radius-md);
  font-weight: 500;
}

.host-key-section {
  margin-top: 16px;
  padding: 12px;
  background-color: var(--bg-secondary);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
}

.host-key-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 500;
  font-size: 13px;
  color: var(--text-primary);
}

.host-key-code {
  word-break: break-all;
  font-family: monospace;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  padding: 8px;
  border-radius: 4px;
}

.host-key-help {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 8px;
}
</style>
