<template>
  <div class="server-stats">
    <div class="stat-section">
      <div class="stat-row">
        <span class="stat-label">{{ t('monitor.cpu') }}</span>
        <span class="stat-num">{{ stats.cpu_percent.toFixed(1) }}%</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" :style="{ width: stats.cpu_percent + '%', background: cpuGradient }"></div>
      </div>
    </div>

    <div class="stat-section">
      <div class="stat-row">
        <span class="stat-label">{{ t('monitor.memory') }}</span>
        <span class="stat-num">{{ formatBytes(stats.mem_used) }} / {{ formatBytes(stats.mem_total) }}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" :style="{ width: memPercent + '%', background: memGradient }"></div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="stat-section">
      <div class="stat-row">
        <span class="stat-label">{{ t('monitor.network') }}</span>
        <el-select v-model="selectedInterface" size="small" class="iface-select">
          <el-option :label="t('monitor.allInterfaces')" value="all" />
          <el-option
            v-for="iface in Object.keys(stats.net_interfaces || {})"
            :key="iface"
            :label="iface"
            :value="iface"
          />
        </el-select>
      </div>
      <div class="net-row">
        <span class="net-item down">
          <span class="legend-dot" style="background:#67c23a"></span>
          <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="5,9 9,3 1,3" fill="currentColor"/></svg>
          {{ formatSpeed(currentRx) }}
        </span>
        <span class="net-item up">
          <span class="legend-dot" style="background:#409eff"></span>
          <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="5,1 9,7 1,7" fill="currentColor"/></svg>
          {{ formatSpeed(currentTx) }}
        </span>
      </div>

      <!-- Chart -->
      <div class="chart-wrapper">
        <div class="chart-scale">
          <span>{{ formatSpeed(chartMax) }}</span>
          <span>{{ formatSpeed(chartMax / 2) }}</span>
          <span>0</span>
        </div>
        <div class="chart-area">
          <svg class="trend-chart" :viewBox="`0 0 ${chartW} ${chartH}`" preserveAspectRatio="none">
            <!-- Grid lines -->
            <line x1="0" :y1="chartH / 2" :x2="chartW" :y2="chartH / 2" stroke="currentColor" opacity="0.1" stroke-width="0.5" stroke-dasharray="3,3" />
            <line x1="0" y1="0" :x2="chartW" y2="0" stroke="currentColor" opacity="0.1" stroke-width="0.5" stroke-dasharray="3,3" />

            <!-- Rx fill -->
            <polygon :points="rxFillPoints" fill="url(#rxGrad)" opacity="0.35" />
            <!-- Tx fill -->
            <polygon :points="txFillPoints" fill="url(#txGrad)" opacity="0.35" />
            <!-- Rx line -->
            <polyline :points="rxLinePoints" fill="none" stroke="#67c23a" stroke-width="1.5" stroke-linejoin="round" />
            <!-- Tx line -->
            <polyline :points="txLinePoints" fill="none" stroke="#409eff" stroke-width="1.5" stroke-linejoin="round" />

            <defs>
              <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#67c23a" />
                <stop offset="100%" stop-color="#67c23a" stop-opacity="0" />
              </linearGradient>
              <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#409eff" />
                <stop offset="100%" stop-color="#409eff" stop-opacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>

    </div>

    <div class="divider"></div>

    <div class="conn-footer">
      <span class="conn-footer-item">TCP: <strong>{{ stats.tcp_conns || 0 }}</strong></span>
      <span class="conn-footer-sep">·</span>
      <span class="conn-footer-item">UDP: <strong>{{ stats.udp_conns || 0 }}</strong></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SysStats } from '../lib/ssh-client'

const { t } = useI18n()

const props = defineProps<{
  stats: SysStats
}>()

const selectedInterface = ref('all')
const historySize = 30
const chartW = 200
const chartH = 40
const rxHistory = ref<number[]>(Array(historySize).fill(0))
const txHistory = ref<number[]>(Array(historySize).fill(0))

const currentRx = computed(() => {
  if (selectedInterface.value === 'all') {
    return Object.values(props.stats.net_interfaces || {}).reduce((sum, intf: any) => sum + Math.max(0, intf.rx_bps), 0)
  }
  return Math.max(0, (props.stats.net_interfaces || {})[selectedInterface.value]?.rx_bps || 0)
})

const currentTx = computed(() => {
  if (selectedInterface.value === 'all') {
    return Object.values(props.stats.net_interfaces || {}).reduce((sum, intf: any) => sum + Math.max(0, intf.tx_bps), 0)
  }
  return Math.max(0, (props.stats.net_interfaces || {})[selectedInterface.value]?.tx_bps || 0)
})

const memPercent = computed(() => {
  if (props.stats.mem_total === 0) return 0
  return (props.stats.mem_used / props.stats.mem_total) * 100
})

watch(() => props.stats, () => {
  rxHistory.value = [...rxHistory.value.slice(1), currentRx.value]
  txHistory.value = [...txHistory.value.slice(1), currentTx.value]
}, { deep: true })

const chartMax = computed(() => {
  const maxData = Math.max(...rxHistory.value, ...txHistory.value, 1)
  // Round up to a nice number
  const order = Math.pow(10, Math.floor(Math.log10(maxData || 1)))
  return Math.max(Math.ceil(maxData / order) * order, 1024)
})

const toY = (val: number) => {
  return chartH - (val / chartMax.value) * chartH
}

const rxLinePoints = computed(() =>
  rxHistory.value.map((v, i) => `${(i / (historySize - 1)) * chartW},${toY(v)}`).join(' ')
)
const txLinePoints = computed(() =>
  txHistory.value.map((v, i) => `${(i / (historySize - 1)) * chartW},${toY(v)}`).join(' ')
)
const rxFillPoints = computed(() =>
  `0,${chartH} ` + rxHistory.value.map((v, i) => `${(i / (historySize - 1)) * chartW},${toY(v)}`).join(' ') + ` ${chartW},${chartH}`
)
const txFillPoints = computed(() =>
  `0,${chartH} ` + txHistory.value.map((v, i) => `${(i / (historySize - 1)) * chartW},${toY(v)}`).join(' ') + ` ${chartW},${chartH}`
)

const cpuGradient = computed(() => {
  const p = props.stats.cpu_percent
  if (p < 60) return 'linear-gradient(90deg, #67c23a, #85ce61)'
  if (p < 85) return 'linear-gradient(90deg, #e6a23c, #f0c78a)'
  return 'linear-gradient(90deg, #f56c6c, #f89898)'
})

const memGradient = computed(() => {
  const p = memPercent.value
  if (p < 70) return 'linear-gradient(90deg, #409eff, #79bbff)'
  if (p < 90) return 'linear-gradient(90deg, #e6a23c, #f0c78a)'
  return 'linear-gradient(90deg, #f56c6c, #f89898)'
})

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const formatSpeed = (bps: number) => {
  if (bps === 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(Math.abs(bps) || 1) / Math.log(k))
  return parseFloat((bps / Math.pow(k, Math.min(i, sizes.length - 1))).toFixed(1)) + ' ' + sizes[Math.min(i, sizes.length - 1)]
}
</script>

<style scoped>
.server-stats {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  color: inherit;
  user-select: none;
}

.stat-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-label {
  font-weight: 600;
  font-size: 12px;
  color: color-mix(in srgb, currentColor 80%, transparent);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-num {
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  color: color-mix(in srgb, currentColor 60%, transparent);
}

.bar-track {
  height: 4px;
  border-radius: 3px;
  background: color-mix(in srgb, currentColor 10%, transparent);
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.8s ease;
}

.divider {
  height: 1px;
  background: color-mix(in srgb, currentColor 15%, transparent);
}

.iface-select {
  width: 120px;
}

.net-row {
  display: flex;
  justify-content: space-between;
}

.net-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
}

.net-item.up { color: #409eff; }
.net-item.down { color: #67c23a; }

.chart-wrapper {
  display: flex;
  gap: 4px;
  height: 40px;
}

.chart-scale {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  font-size: 9px;
  color: color-mix(in srgb, currentColor 50%, transparent);
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  text-align: right;
  min-width: 52px;
  padding: 0 2px;
}

.chart-area {
  flex: 1;
  background: transparent;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
}

.trend-chart {
  width: 100%;
  height: 100%;
  display: block;
}

.conn-footer {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: color-mix(in srgb, currentColor 60%, transparent);
  padding-top: 2px;
}

.conn-footer-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.conn-footer-item strong {
  font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
  font-size: 12px;
  color: inherit;
  font-weight: 500;
  opacity: 0.8;
}

.conn-footer-sep {
  opacity: 0.5;
}

:deep(.el-select) {
  --el-select-input-font-size: 12px;
}
</style>
