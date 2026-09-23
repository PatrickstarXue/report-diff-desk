<script setup lang="ts">
import { DataAnalysis, Document, Grid, Notebook, Switch } from '@element-plus/icons-vue'
import type { Component } from 'vue'
import { useSessionStore } from '../stores/session'

defineProps<{ version: string }>()

const session = useSessionStore()

interface ModuleCard {
  index: string
  name: string
  desc: string
  icon: Component
}

const CARDS: ModuleCard[] = [
  {
    index: 'result',
    name: '整体概览',
    desc: '全局指标与每对文件卡片，变动明细可按列排序、分页翻看',
    icon: DataAnalysis
  },
  {
    index: 'grid',
    name: '高亮显示',
    desc: '原表网格上标出超阈值单元格，右键查口径，支持拖拽平移与缩放',
    icon: Grid
  },
  {
    index: 'template',
    name: '新旧表比对',
    desc: '两套报表按表号配对、按规则值等值比对，规则表可编辑并持久化',
    icon: Switch
  },
  {
    index: 'mapping',
    name: 'Mapping口径',
    desc: '导入映射表或报表文档，点选单元格查对应口径说明',
    icon: Notebook
  },
  {
    index: 'doc',
    name: '官方文档',
    desc: 'PDF 原文翻阅，支持关键字过滤与字号调节',
    icon: Document
  }
]

const STEPS = [
  { title: '选择报表', desc: '进入「高亮显示」页选上期与本期，支持 xlsx / xls 单文件或内含多表的 zip' },
  { title: '开始比对', desc: '按「工作表名 + 单元格坐标」结构对齐，超过阈值即标记' },
  { title: '看结果并导出', desc: '概览看全局、高亮定位原格，可导出 Excel 原格式或 HTML 报告' }
]
</script>

<template>
  <div class="welcome">
    <section class="hero">
      <div class="hero-title">
        报表比对工具
        <span v-if="version" class="hero-version">v{{ version }}</span>
      </div>
      <p class="hero-sub">
        读取上期与本期 Excel 报表，按结构对齐做环比比对，标记超阈值单元格并定位
      </p>
      <p class="hero-note">全部运算在本机完成，不上传云端</p>
    </section>

    <section class="block">
      <h3 class="block-title">快速开始</h3>
      <ol class="steps">
        <li v-for="(s, i) in STEPS" :key="s.title" class="step">
          <span class="step-no">{{ i + 1 }}</span>
          <div>
            <div class="step-title">{{ s.title }}</div>
            <div class="step-desc">{{ s.desc }}</div>
          </div>
        </li>
      </ol>
    </section>

    <section class="block">
      <h3 class="block-title">功能模块</h3>
      <div class="cards">
        <button
          v-for="c in CARDS"
          :key="c.index"
          type="button"
          class="card"
          @click="session.uiTab = c.index"
        >
          <span class="card-icon"><el-icon :size="22"><component :is="c.icon" /></el-icon></span>
          <span class="card-name">{{ c.name }}</span>
          <span class="card-desc">{{ c.desc }}</span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.welcome {
  height: 100%;
  overflow: auto;
  padding: 4px 4px 20px;
}
.hero {
  padding: 26px 28px;
  border-radius: 12px;
  background: linear-gradient(135deg, #eef4ff 0%, #f7f0ff 100%);
  border: 1px solid #e4ebf7;
}
.hero-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 24px;
  font-weight: 700;
  color: #1f2d3d;
}
.hero-version {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-color-primary);
  background: #fff;
  border: 1px solid #d9e6ff;
  border-radius: 999px;
  padding: 2px 10px;
}
.hero-sub {
  margin: 12px 0 0;
  font-size: 14px;
  color: #5a6a80;
}
.hero-note {
  margin: 8px 0 0;
  font-size: 12px;
  color: #8b98a8;
}
.block {
  margin-top: 22px;
}
.block-title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #5a6a80;
}
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.step {
  flex: 1 1 260px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  background: #fff;
}
.step-no {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.step-title {
  font-size: 14px;
  font-weight: 600;
  color: #1f2d3d;
}
.step-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: #8b98a8;
}
.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.card {
  flex: 1 1 220px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 16px;
  text-align: left;
  font: inherit;
  cursor: pointer;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  transition:
    border-color 0.15s,
    transform 0.15s,
    box-shadow 0.15s;
}
.card:hover {
  border-color: var(--el-color-primary-light-5);
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(64, 158, 255, 0.12);
}
.card-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.card-name {
  font-size: 14px;
  font-weight: 600;
  color: #1f2d3d;
}
.card-desc {
  font-size: 12px;
  line-height: 1.6;
  color: #8b98a8;
}
</style>
