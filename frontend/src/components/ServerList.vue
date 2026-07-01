<template>
  <div class="server-list" v-loading="serverStore.isLoading">
    <div v-if="serverStore.servers.length === 0" class="empty-state">
      <el-icon :size="32" class="empty-icon"><Monitor /></el-icon>
      <p>{{ $t('serverList.noServers') }}</p>
    </div>

    <div v-else class="grouped-list">
      
      <!-- Tag Filter Bar -->
      <div v-if="serverStore.availableTags.length > 0" class="tag-filter-bar">
        <!-- "All" Filter -->
        <span 
          class="premium-tag filter-tag"
          :class="{ 'is-active': selectedFilterTags.size === 0 }"
          :style="getTagStyle('__ALL__', selectedFilterTags.size === 0)"
          @click="selectedFilterTags.clear()"
        >
          {{ $t('serverList.all') || '全部' }}
        </span>
        
        <!-- Specific Tags -->
        <span 
          v-for="tag in serverStore.availableTags" 
          :key="tag"
          class="premium-tag filter-tag"
          :class="{ 'is-active': selectedFilterTags.has(tag) }"
          :style="getTagStyle(tag, selectedFilterTags.has(tag))"
          @click="toggleFilterTag(tag)"
        >
          {{ tag }}
        </span>
      </div>

      <el-collapse v-model="activeNames">
        <el-collapse-item 
          v-for="(servers, groupName) in filteredGroupedServers" 
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
            :class="{ 'is-selected': isSelectMode && selectedIds?.has(server.id) }"
            @click="handleItemClick(server.id)"
          >
            <div class="server-checkbox-wrapper" :class="{ 'is-visible': isSelectMode }" @click.stop>
              <el-checkbox 
                :model-value="selectedIds?.has(server.id)" 
                @update:model-value="toggleSelection(server.id)"
              />
            </div>

            <div class="server-icon-wrapper">
              <OsIcon :os="server.credentials.os" size="24" />
            </div>
            <div class="server-info">
              <div class="server-name">{{ server.name }}</div>
              <div class="server-host">{{ server.credentials.username }}@{{ server.credentials.host }}</div>
              <div v-if="server.credentials.tags && server.credentials.tags.length > 0" class="server-tags">
                <span 
                  v-for="tag in server.credentials.tags" 
                  :key="tag" 
                  class="premium-tag"
                  :style="getTagStyle(tag)"
                >
                  {{ tag }}
                </span>
              </div>
            </div>
            
            <div v-if="!isSelectMode" class="server-actions" @click.stop>
              <el-dropdown trigger="click" placement="bottom-end" @command="handleCommand($event, server)">
                <el-button size="small" text class="action-btn">
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="edit" :icon="Edit">{{ $t('serverList.edit') }}</el-dropdown-item>
                    <el-dropdown-item command="export" :icon="Upload">{{ $t('dashboard.exportSelected') || 'Export' }}</el-dropdown-item>
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
import { onMounted, ref, watch, computed } from 'vue'
import { useServerStore } from '../stores/server'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Monitor, MoreFilled, Edit, Delete, Upload } from '@element-plus/icons-vue'
import OsIcon from './OsIcon.vue'
import { useI18n } from 'vue-i18n'

const serverStore = useServerStore()
const { t } = useI18n()

const props = defineProps<{
  compact?: boolean
  isSelectMode?: boolean
  selectedIds?: Set<string>
}>()

const emit = defineEmits<{
  (e: 'connect', id: string): void
  (e: 'edit', server: any): void
  (e: 'update:selectedIds', ids: Set<string>): void
}>()

const activeNames = ref<string[]>([])

const selectedFilterTags = ref<Set<string>>(new Set())

const toggleFilterTag = (tag: string) => {
  const newSet = new Set(selectedFilterTags.value)
  if (newSet.has(tag)) {
    newSet.delete(tag)
  } else {
    newSet.add(tag)
  }
  selectedFilterTags.value = newSet
}

const filteredGroupedServers = computed(() => {
  if (selectedFilterTags.value.size === 0) {
    return serverStore.groupedServers
  }

  const result: Record<string, import('../stores/server').DecryptedServer[]> = {}
  for (const [group, servers] of Object.entries(serverStore.groupedServers)) {
    const filtered = servers.filter(srv => {
      const srvTags = srv.credentials.tags || []
      // AND logic: Server must have ALL selected tags
      return Array.from(selectedFilterTags.value).every(t => srvTags.includes(t))
    })
    if (filtered.length > 0) {
      result[group] = filtered
    }
  }
  return result
})

const getTagStyle = (tag: string, isActive = true) => {
  if (!isActive) {
    return {
      color: 'var(--text-secondary)',
      backgroundColor: 'var(--bg-secondary)',
      border: 'none',
      opacity: 0.5
    }
  }

  if (tag === '__ALL__') {
    return {
      color: 'var(--text-primary)',
      backgroundColor: 'rgba(120, 120, 120, 0.3)',
      border: 'none'
    }
  }

  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360

  return {
    color: `hsl(${hue}, 80%, 75%)`,
    backgroundColor: `hsl(${hue}, 35%, 25%)`,
    border: 'none'
  }
}

watch(() => filteredGroupedServers.value, (groups) => {
  if (activeNames.value.length === 0) {
    activeNames.value = Object.keys(groups)
  }
}, { immediate: true })

onMounted(async () => {
  await serverStore.fetchServers()
})

const toggleSelection = (id: string) => {
  if (!props.isSelectMode || !props.selectedIds) return
  const newSet = new Set(props.selectedIds)
  if (newSet.has(id)) {
    newSet.delete(id)
  } else {
    newSet.add(id)
  }
  emit('update:selectedIds', newSet)
}

const handleItemClick = (id: string) => {
  if (props.isSelectMode) {
    toggleSelection(id)
  } else {
    emit('connect', id)
  }
}

const handleCommand = (command: string, row: any) => {
  if (command === 'edit') {
    emit('edit', row)
  } else if (command === 'export') {
    try {
      serverStore.exportServersJSON([row.id])
      ElMessage.success(t('dashboard.exportSuccess') || 'Export successful')
    } catch (err: any) {
      ElMessage.error(err.message || 'Failed to export')
    }
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
  transition: background-color 0.2s, padding-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background-color: var(--bg-primary);
}

.server-item.is-selected {
  background-color: rgba(var(--el-color-primary-rgb), 0.05);
}

.server-item:last-child {
  border-bottom: none;
}

.server-item:hover {
  background-color: var(--bg-primary);
}

.server-checkbox-wrapper {
  width: 0;
  overflow: hidden;
  opacity: 0;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
}

.server-checkbox-wrapper.is-visible {
  width: 24px;
  opacity: 1;
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
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
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

.server-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.premium-tag {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  font-size: 11px;
  line-height: 20px;
  height: 20px;
  font-weight: 600;
  border-radius: 9999px;
  border: none;
  max-width: 90px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
  user-select: none;
}

.premium-tag:not(.filter-tag):hover {
  transform: translateY(-1px);
  filter: brightness(1.2);
}

.tag-filter-bar {
  display: flex;
  gap: 6px;
  padding: 12px 16px;
  overflow-x: auto;
  white-space: nowrap;
  border-bottom: 1px solid var(--border-color);
  -ms-overflow-style: none;  /* IE and Edge */
  scrollbar-width: none;  /* Firefox */
}

.tag-filter-bar::-webkit-scrollbar {
  display: none;
}

.filter-tag {
  cursor: pointer;
  max-width: none;
  font-size: 11px;
  height: 24px;
  line-height: 24px;
  padding: 0 12px;
  font-weight: 600;
}

.filter-tag:hover {
  filter: brightness(1.1);
  transform: scale(1.02);
}

.filter-tag.is-active {
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
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
