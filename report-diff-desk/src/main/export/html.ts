import type { CompareResult, DiffKind } from '@shared/types'
import { KIND_LABEL } from '@shared/core/engine'

const ROW_CLASS: Record<DiffKind, string> = {
  increase: 'inc',
  decrease: 'dec',
  'zero-base': 'extra',
  new: 'extra',
  removed: 'extra'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function rateText(rate: number | null): string {
  return rate === null ? '-' : `${(rate * 100).toFixed(1)}%`
}

function valueText(v: string | number | boolean | null): string {
  return v === null || v === '' ? '（空）' : escapeHtml(String(v))
}

/** 自包含 HTML 报告：内嵌 CSS 与数据、按 sheet 分组、无任何外链 */
export function buildHtmlReport(result: CompareResult): string {
  const groups = new Map<string, typeof result.diffs>()
  for (const d of result.diffs) {
    const list = groups.get(d.sheet) ?? []
    list.push(d)
    groups.set(d.sheet, list)
  }

  const body = [...groups.entries()]
    .map(([sheet, diffs]) => {
      const rows = diffs
        .map(
          (d) => `<tr class="${ROW_CLASS[d.kind]}">
  <td>${d.ref}</td><td>${valueText(d.prevValue)}</td><td>${valueText(d.currValue)}</td>
  <td class="rate">${rateText(d.changeRate)}</td><td>${KIND_LABEL[d.kind]}</td>
</tr>`
        )
        .join('\n')
      return `<h3>${escapeHtml(sheet)}<span class="count">${diffs.length} 处</span></h3>
<table>
<thead><tr><th>坐标</th><th>上期值</th><th>本期值</th><th>变动率</th><th>类型</th></tr></thead>
<tbody>\n${rows}\n</tbody>
</table>`
    })
    .join('\n')

  const extraNote =
    result.sheetsOnlyInBase.length || result.sheetsOnlyInCurr.length
      ? `<p class="note">未参与比对：仅上期 ${result.sheetsOnlyInBase.map(escapeHtml).join('、') || '无'}；仅本期 ${result.sheetsOnlyInCurr.map(escapeHtml).join('、') || '无'}</p>`
      : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>报表比对结果</title>
<style>
body { font-family: "Microsoft YaHei", "PingFang SC", sans-serif; margin: 24px; color: #303133; }
h1 { font-size: 20px; }
h3 { font-size: 15px; margin: 24px 0 8px; }
.meta { color: #909399; font-size: 13px; }
.note { color: #e6a23c; font-size: 13px; }
.count { color: #909399; font-weight: normal; font-size: 12px; margin-left: 8px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid #dcdfe6; padding: 6px 10px; text-align: left; }
th { background: #f5f7fa; }
tr.inc td { background: #fde2e2; }
tr.dec td { background: #e1f3d8; }
tr.extra td { background: #fdf6ec; }
td.rate { text-align: right; }
</style>
</head>
<body>
<h1>报表比对结果</h1>
<p class="meta">上期：${escapeHtml(result.baseLabel)}　→　本期：${escapeHtml(result.currLabel)}　阈值：${(result.threshold * 100).toFixed(0)}%　生成时间：${new Date(result.generatedAt).toLocaleString('zh-CN')}</p>
<p class="meta">变动合计 ${result.diffs.length} 处 / 共比对 ${result.totalCellsCompared} 个单元格</p>
${extraNote}
${body}
</body>
</html>`
}
