<template>
  <div class="server-list" v-loading="serverStore.isLoading">
    <div v-if="serverStore.servers.length === 0" class="empty-state">
      <el-icon :size="32" class="empty-icon"><Monitor /></el-icon>
      <p>{{ $t('serverList.noServers') }}</p>
    </div>

    <div v-else class="grouped-list">
      <el-collapse v-model="activeNames">
        <el-collapse-item 
          v-for="(servers, groupName) in serverStore.groupedServers" 
          :key="groupName" 
          :name="groupName"
        >
          <template #title>
            <div class="group-title">
              {{ groupName || $t('serverList.uncategorized') }}
              <span class="group-badge-count">{{ servers.length }}</span>
            </div>
          </template>

          <div 
            v-for="server in servers" 
            :key="server.id" 
            class="server-item"
            @click="$emit('connect', server.id)"
          >
            <div class="server-icon-wrapper">
              <OsIcon :os="server.credentials.os" />
            </div>
            <div class="server-info">
              <div class="server-name">{{ server.name }}</div>
              <div class="server-host">{{ server.credentials.username }}@{{ server.credentials.host }}</div>
            </div>
            
            <div class="server-actions" @click.stop>
              <el-dropdown trigger="click" @command="handleCommand($event, server)">
                <el-button size="small" text class="action-btn">
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit" :icon="Edit">{{ $t('serverList.edit') }}</el-dropdown-item>
                    <el-dropdown-item command="delete" :icon="Delete" divided class="danger-item">{{ $t('serverList.deleteServer') }}</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useServerStore } from '../stores/server'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Monitor, MoreFilled, Edit, Delete } from '@element-plus/icons-vue'
import OsIcon from './OsIcon.vue'
import { useI18n } from 'vue-i18n'

const serverStore = useServerStore()
const { t } = useI18n()

const emit = defineEmits<{
  (e: 'connect', id: string): void
  (e: 'edit', server: any): void
}>()

const activeNames = ref<string[]>([])

watch(() => serverStore.groupedServers, (groups) => {
  if (activeNames.value.length === 0) {
    activeNames.value = Object.keys(groups)
  }
}, { immediate: true })

onMounted(async () => {
  await serverStore.fetchServers()
})

const handleCommand = (command: string, row: any) => {
  if (command === 'edit') {
    emit('edit', row)
  } else if (command === 'delete') {
    confirmDelete(row.id)
  }
}

const confirmDelete = (id: string) => {
  ElMessageBox.confirm(
    t('serverList.deleteConfirm'),
    t('serverList.deleteServer'),
    {
      confirmButtonText: t('serverList.deleteBtn'),
      cancelButtonText: t('serverList.cancelBtn'),
      type: 'warning',
      confirmButtonClass: 'el-button--danger'
    }
  ).then(async () => {
    try {
      await serverStore.deleteServer(id)
      ElMessage.success(t('serverList.deleteSuccess'))
    } catch (err: any) {
      ElMessage.error(err.message || t('serverList.deleteFailed'))
    }
  }).catch(() => {
    // cancelled
  })
}
</script>

<style scoped>
.server-list {
  display: flex;
  flex-direction: column;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-secondary);
}

.empty-icon {
  margin-bottom: 12px;
  opacity: 0.5;
}

.grouped-list {
  display: flex;
  flex-direction: column;
}

.group-title {
  display: flex;
  align-items: center;
  font-weight: 500;
  font-size: 0.9rem;
  color: var(--text-primary);
}

.group-badge-count {
  margin-left: 8px;
  background-color: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  height: 20px;
}

:deep(.el-collapse-item__header) {
  padding: 0 16px;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  height: 40px;
  line-height: 40px;
}

:deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

:deep(.el-collapse-item__content) {
  padding-bottom: 0;
}

.server-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  gap: 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--border-color);
  transition: background-color 0.2s;
  background-color: var(--bg-primary);
}

.server-item:last-child {
  border-bottom: none;
}

.server-item:hover {
  background-color: var(--bg-primary);
}

.server-icon-wrapper {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.server-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.server-name {
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.server-host {
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.server-actions {
  opacity: 0;
  transition: opacity 0.2s;
}

.server-item:hover .server-actions {
  opacity: 1;
}

.action-btn {
  padding: 4px 8px;
  height: 28px;
}

:deep(.danger-item) {
  color: #ef4444 !important;
}
</style>
