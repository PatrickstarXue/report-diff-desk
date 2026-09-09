<script setup lang="ts">
import { computed } from 'vue'
import type { BatchCompareResult, DiffKind } from '@shared/types'
import { buildOverview } from '@shared/core/summary'

const props = defineProps<{
  compareResult: BatchCompareResult
  /** 当前选中的文件对索引（null = 未选中/显示全部） */
  activeIndex: number | null
}>()
const emit = defineEmits<{ select: [index: number | null] }>()

const overview = computed(() => buildOverview(props.compareResult))

const KIND_BAR_COLORS: Record<DiffKind, string> = {
  increase: '#f56c6c',
  decrease: '#67c23a',
  'zero-base': '#e6a23c',
  new: '#b695ce',
  removed: '#c0c4cc'
}

/** 五类构成条的宽度百分比（按各自占比取整） */
function barSegments(counts: Record<DiffKind, number>): { pct: number; color: string; kind: DiffKind }[] {
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  if (total === 0) return []
  const kinds: DiffKind[] = ['increase', 'decrease', 'zero-base', 'new', 'removed']
  return kinds
    .map((k) => ({ pct: Math.round((counts[k] / total) * 100), color: KIND_BAR_COLORS[k], kind: k }))
    .filter((s) => s.pct > 0)
}

function truncate(name: string): string {
  return name.length > 40 ? name.slice(0, 37) + '…' : name
}
</script>

<template>
  <div v-if="overview.pairSummaries.length" class="overview-panel">
    <!-- 全局指标条 -->
    <div class="overview-stats">
      <div class="stat-card">
        <div class="stat-num">{{ overview.totalPairs }}</div>
        <div class="stat-label">配对文件</div>
      </div>
      <div class="stat-card stat-diff">
        <div class="stat-num">{{ overview.totalDiffs }}</div>
        <div class="stat-label">变动合计</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">{{ overview.unmatched.length }}</div>
        <div class="stat-label">未参与</div>
      </div>
    </div>
    <div v-if="overview.unmatched.length" class="overview-unmatched">
      未参与文件：{{ overview.unmatched.join('、') }}
    </div>
    <!-- 文件对卡片 -->
    <div class="overview-pairs">
      <div
        v-for="ps in overview.pairSummaries"
        :key="ps.index"
        class="pair-card"
        :class="{
          'pair-card--active': activeIndex === ps.index,
          'pair-card--empty': ps.totalDiffs === 0
        }"
        @click="emit('select', activeIndex === ps.index ? null : ps.index)"
      >
        <div class="pair-name" :title="ps.baseFileName + ' → ' + ps.currFileName">
          {{ truncate(ps.baseFileName) }} → {{ truncate(ps.currFileName) }}
        </div>
        <div class="pair-body">
          <span class="pair-num" :class="{ 'pair-num--zero': ps.totalDiffs === 0 }">
            {{ ps.totalDiffs }}
          </span>
          <span class="pair-unit">{{ ps.totalDiffs === 0 ? '无变动' : '处变动' }}</span>
          <!-- 五类构成条 -->
          <div v-if="ps.totalDiffs > 0" class="pair-bar">
            <div
              v-for="(seg, i) in barSegments(ps.counts)"
              :key="i"
              class="bar-seg"
              :style="{ width: seg.pct + '%', background: seg.color }"
              :title="seg.kind + ' ' + ps.counts[seg.kind]"
            />
          </div>
        </div>
        <div class="pair-footer">
          匹配 {{ ps.matchedSheets }} 工作表
          <template v-if="ps.peakChangeLabel"> · 峰值 {{ ps.peakChangeLabel }}</template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overview-panel {
  padding: 12px 0 4px;
}
.overview-stats {
  display: flex;
  gap: 10px;
  margin-bottom: 8px;
}
.stat-card {
  flex: 1;
  background: #f5f7fa;
  border-radius: 8px;
  padding: 10px 8px;
  text-align: center;
}
.stat-num {
  font-size: 20px;
  font-weight: 700;
}
.stat-diff .stat-num {
  color: #d6336c;
}
.stat-label {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}
.overview-unmatched {
  font-size: 12px;
  color: #e6a23c;
  margin: 4px 0 10px;
  background: #fdf6ec;
  border-radius: 6px;
  padding: 6px 10px;
}
.overview-pairs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.pair-card {
  flex: 1 1 320px;
  border: 1px solid #dcdfe6;
  border-radius: 10px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.pair-card:hover {
  border-color: #a0cfff;
}
.pair-card--active {
  border: 2px solid #409eff;
  background: #f5f7fa;
}
.pair-card--empty {
  opacity: 0.6;
}
.pair-name {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 6px;
}
.pair-body {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 6px;
}
.pair-num {
  font-size: 22px;
  font-weight: 700;
  color: #d6336c;
}
.pair-num--zero {
  color: #909399;
}
.pair-unit {
  font-size: 12px;
  color: #909399;
}
.pair-bar {
  flex: 1;
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  margin-left: 8px;
}
.bar-seg {
  min-width: 2px;
}
.pair-footer {
  font-size: 11px;
  color: #909399;
}
</style>
