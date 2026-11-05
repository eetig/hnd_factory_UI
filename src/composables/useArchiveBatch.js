import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { aiSuggestArchive } from '../api/archive'

/**
 * 批量上传的状态与流程（2026-11-05）。
 *
 * <p>从 ArchivePanel.vue 抽出来的原因（review S5）：那个文件一天之内长到 901 行，
 * 同时管列表、抽屉、批量、预览四件事。批量这段是纯逻辑（收文件、过滤、逐条传、汇总），
 * 和模板只通过几个 ref 交互，最适合先搬走。
 *
 * @param {object} deps
 * @param {(file: File) => Promise<object>} deps.upload 上传单个文件
 * @param {(form: object) => Promise<void>} deps.save 保存一条记录
 * @param {() => Promise<void>} deps.load 刷新列表
 * @param {() => Promise<void>} deps.loadCategories 刷新分类
 * @param {import('vue').ComputedRef<Array>} deps.categoryOptions 分类下拉项
 * @param {import('vue').Ref<number|null>} deps.categoryId 当前所在分类
 */
export function useArchiveBatch({ upload, save, load, loadCategories, categoryOptions, categoryId }) {
/* 批量上传（2026-11-05，从 ArchivePanel.vue 抽出，review S5）
 * 使用方：「上传资料可以多选，甚至可以选文件夹」。
 *
 * 设计要点（都经过确认）：
 *   · 文件夹递归读、按白名单过滤，**先给清单再传** —— 文件夹里混着 .DS_Store、
 *     ~$xxx.docx、微信 .dat 是常态，静默丢掉会让人以为"传丢了"。
 *   · 默认**不调 AI**：批量场景多是同类资料，逐条调模型既慢又没必要；
 *     要看逐条判断就勾上，进度里会显示第几个。
 *   · 每条仍走「上传 → 保存」两步，失败不影响其它条，最后给成功/失败清单。
 */
const SUPPORTED_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg', 'txt', 'csv', 'zip']

const batchOpen = ref(false)
const batchFiles = ref([]) // [{ file, name, size, ok, reason }]
const batchCategoryId = ref(null)
const batchUseAi = ref(false)
const batchRunning = ref(false)
const batchDone = ref(0)
const batchResults = ref([]) // [{ name, ok, message }]
const batchInput = ref(null) // 多选
const batchDirInput = ref(null) // 选文件夹

/** 从 FileList 收一批文件（多选 / 文件夹共用） */
function collectFiles(fileList) {
  const list = []
  for (const file of Array.from(fileList || [])) {
    const name = file.name || ''
    // 文件夹上传时 webkitRelativePath 带目录，用来判断"这是个临时文件"
    const relative = file.webkitRelativePath || name
    const ext = (name.split('.').pop() || '').toLowerCase()
    const base = name.split('/').pop() || name
    let ok = true
    let reason = ''
    if (base.startsWith('~$') || base.startsWith('.')) {
      ok = false
      reason = '临时文件'
    } else if (!ext || !SUPPORTED_EXT.includes(ext)) {
      ok = false
      reason = ext ? `不支持 .${ext}` : '没有扩展名'
    }
    list.push({ file, name: relative, size: file.size, ok, reason })
  }
  return list
}

function pickBatchFiles() {
  batchInput.value?.click()
}

function pickBatchFolder() {
  batchDirInput.value?.click()
}

function onBatchPicked(event) {
  const picked = collectFiles(event.target.files)
  event.target.value = '' // 允许再次选同名文件
  if (!picked.length) return
  batchFiles.value = picked
  batchResults.value = []
  batchDone.value = 0
  batchCategoryId.value = categoryId.value || categoryOptions.value[0]?.value || null
  batchUseAi.value = false
  batchOpen.value = true
}

const batchValidCount = computed(() => batchFiles.value.filter((f) => f.ok).length)
const batchSkippedCount = computed(() => batchFiles.value.filter((f) => !f.ok).length)

/** 开始批量上传：逐条「上传 → 保存」，失败不中断 */
async function runBatch() {
  if (batchRunning.value) return
  const valid = batchFiles.value.filter((f) => f.ok)
  if (!valid.length) {
    ElMessage.info('没有可上传的文件')
    return
  }
  /*
   * C2（review 2026-11-05）：不勾 AI 时必须有统一分类。
   * 否则每一条都会被后端拒「请选择分类」，用户看到一屏一模一样的红字。
   * 勾了 AI 时可以留空 —— 由建议补；补不上再退回统一分类（可能仍为空，由下面兜底）。
   */
  if (!batchUseAi.value && !batchCategoryId.value) {
    ElMessage.info('请先选一个统一分类（或勾选「逐条 AI 归类」让模型判断）')
    return
  }
  batchRunning.value = true
  batchDone.value = 0
  batchResults.value = []
  let okCount = 0
  /** C1：upload 成功但 save 失败的个数 —— 这些文件已经在服务器上，必须让人知道 */
  let orphanCount = 0
  for (const item of valid) {
    try {
      const uploaded = await upload(item.file)
      let suggestion = null
      if (batchUseAi.value) {
        try {
          const res = await aiSuggestArchive(item.file)
          const body = res?.data || {}
          suggestion = body.success === false ? null : body.data
        } catch {
          suggestion = null
        }
      }
      await save({
        id: null,
        name: (suggestion?.name || item.file.name).replace(/\.[^.]+$/, '').slice(0, 128),
        categoryId: suggestion?.categoryId || batchCategoryId.value,
        fileName: uploaded.fileName,
        origName: uploaded.origName || item.file.name,
        fileSize: uploaded.size,
        mimeType: uploaded.contentType || '',
        expireDate: suggestion?.expireDate || '',
        originPlace: '',
        docNo: suggestion?.docNo || '',
        owner: suggestion?.owner || '',
        remark: suggestion?.summary || '',
      })
      okCount += 1
      batchResults.value.push({ name: item.name, ok: true, message: '已保存' })
    } catch (e) {
      const status = e?.response?.status
      // C1：走到这里说明 upload 已成功（否则会是上传失败），文件已在 file-service 上
      orphanCount += 1
      batchResults.value.push({
        name: item.name,
        ok: false,
        message: e?.response?.data?.msg || e?.message || '上传失败',
      })
      /*
       * 登录过期就整批停手（2026-11-05）。
       * 之前是继续跑完剩下几十个，每条都 401 —— 用户看到一屏红字，还要自己猜原因。
       * 现在停在第一条，明确告诉他去重新登录，并说明已传成功的那些是好的。
       */
      if (status === 401) {
        batchRunning.value = false
        ElMessage.warning('登录已过期，批量上传已暂停（已上传成功的文件不会丢），请重新登录后再继续')
        return
      }
    }
    batchDone.value += 1
  }
  batchRunning.value = false
  await load()
  await loadCategories()
  ElMessage.success(`批量上传完成：成功 ${okCount} / ${valid.length}`)
  /*
   * C1（review 2026-11-05）：孤儿文件必须说清楚。
   * upload 成功、save 失败的那些文件已经落在服务器上，界面上没有记录 ⇒ 删不掉。
   * 不告诉人，就会悄悄堆成"看得见的磁盘、看不见的垃圾"。
   */
  if (orphanCount > 0) {
    ElMessage.warning(
      `有 ${orphanCount} 个文件已上传但没入库（界面上没有记录，删不掉），请把这条提示截图给管理员清理`,
    )
  }
}

function closeBatch() {
  if (batchRunning.value) return
  batchOpen.value = false
  batchFiles.value = []
  batchResults.value = []
}


  return {
    batchOpen,
    batchFiles,
    batchCategoryId,
    batchUseAi,
    batchRunning,
    batchDone,
    batchResults,
    batchInput,
    batchDirInput,
    batchValidCount,
    batchSkippedCount,
    onBatchPicked,
    pickBatchFiles,
    pickBatchFolder,
    runBatch,
    closeBatch,
  }
}
