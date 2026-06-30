<template>
  <el-icon :size="size" :class="customClass" :style="{ color }">
    <Icon v-if="osIconName" :icon="osIconName" />
    <Icon v-else icon="lucide:server" />
  </el-icon>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  os?: string
  size?: number | string
  color?: string
  customClass?: string
}>()

const osIconName = computed(() => {
  if (!props.os) return ''
  const s = props.os.toLowerCase()
  if (s.includes('ubuntu')) return 'logos:ubuntu'
  if (s.includes('debian')) return 'logos:debian'
  if (s.includes('centos')) return 'logos:centos-icon'
  if (s.includes('alpine')) return 'logos:alpinejs-icon'
  if (s.includes('fedora')) return 'logos:fedora'
  if (s.includes('rocky')) return 'logos:rocky-linux-icon'
  if (s.includes('arch')) return 'logos:archlinux'
  if (s.includes('suse') || s.includes('sles')) return 'logos:suse'
  if (s.includes('redhat') || s.includes('rhel')) return 'logos:redhat-icon'
  if (s.includes('mac') || s.includes('darwin')) return 'logos:apple'
  if (s.includes('win')) return 'logos:microsoft-windows-icon'
  if (s.includes('linux')) return 'logos:linux-tux'
  return ''
})
</script>
