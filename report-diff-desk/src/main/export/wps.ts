import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 借本机 WPS/Excel 的 COM 接口把 .xls（BIFF8）转成 .xlsx。
 *
 * 纯 Node 生态拿不到 biff8 的字体/居中/边框（exceljs 读不了 biff8，SheetJS 社区版不暴露样式），
 * 而 WPS 本体读得懂也写得对——实测转换后字体、居中、边框、合并、数值格式逐项与原表一致。
 * 因此这里只做「格式转换」，染色与双 sheet 组装仍由 excel.ts 的 exceljs 路径负责。
 */

export interface XlsJob {
  inFile: string
  outFile: string
}

/** 传给 PowerShell 的参数 JSON（ASCII 落盘路径 + UTF-8 内容，脚本用 ReadAllText 读，绕开本机 GBK ANSI） */
export function buildWpsParams(jobs: XlsJob[]): string {
  return JSON.stringify({ jobs })
}

/** PowerShell 单引号字符串转义：内部单引号写两遍 */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * 生成转换脚本正文。必须保持 ASCII-only——所有路径走参数 JSON，不拼进脚本文本，
 * 既避开编码问题，也免疫路径注入。
 *
 * xlOpenXMLWorkbook = 51。
 */
export function buildWpsScript(paramsPath: string, errorFile: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$paramsPath = ${psQuote(paramsPath)}`,
    `$errorFile = ${psQuote(errorFile)}`,
    'try {',
    '  $cfg = [System.IO.File]::ReadAllText($paramsPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json',
    '  $app = New-Object -ComObject Excel.Application',
    // Visible 为真说明附着到了用户正在用的实例，此时绝不能 Quit，否则会关掉他未保存的工作
    '  $attached = [bool]$app.Visible',
    '  $prevAlerts = $app.DisplayAlerts',
    '  try {',
    '    $app.DisplayAlerts = $false',
    '    foreach ($job in $cfg.jobs) {',
    '      $wb = $app.Workbooks.Open($job.inFile, 0, $true)',
    '      try { $wb.SaveAs($job.outFile, 51) } finally { $wb.Close($false) }',
    '    }',
    '  } finally {',
    '    $app.DisplayAlerts = $prevAlerts',
    '    if (-not $attached) { $app.Quit() }',
    '    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)',
    '  }',
    '  exit 0',
    '} catch {',
    '  [System.IO.File]::WriteAllText($errorFile, $_.Exception.Message, [System.Text.Encoding]::UTF8)',
    '  exit 1',
    '}'
  ].join('\r\n')
}

const PROBE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  'try {',
  '  $app = New-Object -ComObject Excel.Application',
  '  $attached = [bool]$app.Visible',
  '  if (-not $attached) { $app.Quit() }',
  '  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)',
  '  exit 0',
  '} catch {',
  '  exit 1',
  '}'
].join('\r\n')

const PROBE_TIMEOUT_MS = 20_000

/** 超时是兜底而非主要清理手段：kill 只杀得掉 powershell，杀不掉 COM 拉起的 et.exe */
function timeoutFor(jobCount: number): number {
  return 30_000 + 5_000 * jobCount
}

function powershellPath(): string {
  const abs = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  return existsSync(abs) ? abs : 'powershell.exe'
}

/**
 * 用 -EncodedCommand 执行，不往 %TEMP% 写 .ps1——写脚本再执行会命中 Defender 的
 * ASR/SmartScreen 启发式，而本应用未签名，容易被拦。
 */
function runPowerShell(script: string, timeoutMs: number): Promise<{ code: number; stderr: string }> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    // 两路都要消费，否则管道填满会把子进程卡死
    child.stdout?.resume()
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stderr })
    })
  })
}

/** 只缓存正结果：一次抖动导致的负结果若被缓存，整场会话都会悄悄退回降级路径 */
let wpsOk = false

export async function detectWps(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  if (wpsOk) return true
  try {
    const { code } = await runPowerShell(PROBE_SCRIPT, PROBE_TIMEOUT_MS)
    if (code === 0) wpsOk = true
  } catch {
    // 起不来 powershell 就按不可用处理
  }
  return wpsOk
}

/** 串行化：两次导出并发时不要互相附着到对方的 COM 实例 */
let queue: Promise<unknown> = Promise.resolve()

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

async function readWpsError(errorFile: string, code: number): Promise<string> {
  try {
    const msg = (await readFile(errorFile, 'utf-8')).trim()
    if (msg) return `WPS 转换失败：${msg}`
  } catch {
    // 脚本没跑到写错误文件那步
  }
  return `WPS 转换失败（退出码 ${code}）`
}

async function doConvert(buffers: Buffer[]): Promise<Buffer[]> {
  const dir = await mkdtemp(join(tmpdir(), 'rdd-wps-'))
  try {
    const jobs: XlsJob[] = buffers.map((_, i) => ({
      inFile: join(dir, `in-${i}.xls`),
      outFile: join(dir, `out-${i}.xlsx`)
    }))
    await Promise.all(buffers.map((buf, i) => writeFile(jobs[i].inFile, buf)))

    const paramsPath = join(dir, 'jobs.json')
    const errorFile = join(dir, 'error.txt')
    await writeFile(paramsPath, buildWpsParams(jobs), 'utf-8')

    const { code, stderr } = await runPowerShell(buildWpsScript(paramsPath, errorFile), timeoutFor(jobs.length))
    // -EncodedCommand 只在终止性错误上给非 0 退出码，但输出文件是否存在/非空才是最终判据
    if (code !== 0) throw new Error(await readWpsError(errorFile, code))

    return await Promise.all(
      jobs.map(async (job) => {
        let out: Buffer
        try {
          out = await readFile(job.outFile)
        } catch {
          throw new Error(`WPS 未产出文件（退出码 0）：${stderr.trim() || job.outFile}`)
        }
        if (out.length === 0) throw new Error(`WPS 产出空文件：${job.outFile}`)
        return out
      })
    )
  } finally {
    // 超时被杀时 COM 可能还占着文件，force 只吞 ENOENT 不吞 EBUSY；
    // 清理自身再包一层，否则它会盖掉真正的错误并漏掉目录
    await rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
  }
}

/** 批量把 .xls 的 buffer 转成 .xlsx 的 buffer，顺序与入参一一对应 */
export function convertXlsToXlsx(buffers: Buffer[]): Promise<Buffer[]> {
  if (buffers.length === 0) return Promise.resolve([])
  return serialize(() => doConvert(buffers))
}
