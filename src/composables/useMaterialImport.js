import { computed, ref } from 'vue'
import request from '../api/request'

/*
 * 物料主数据导入的数据层（2026-10-23，变更-159）。
 *
 * 两阶段：preview 只解析 + 比对（返回 token 与差异统计），commit 凭 token 落库。
 * 前端只管"选文件 → 看差异 → 确认"，不做任何 diff —— 口径只保留在后端一份。
 */

const file = ref(null)
const fileName = ref('')
const preview = ref(null)
const result = ref(null)
const loading = ref(false)
const committing = ref(false)
const error = ref('')

const canPreview = computed(() => !!file.value && !loading.value)
const canCommit = computed(() => !!preview.value?.token && !committing.value)

function pickFile(selected) {
  if (!selected) return
  const name = selected.name || ''
  if (!/\.(xlsx|xls)$/i.test(name)) {
    error.value = '只支持 .xlsx / .xls 文件。'
    return
  }
  file.value = selected
  fileName.value = name
  preview.value = null
  result.value = null
  error.value = ''
}

async function runPreview() {
  if (!file.value) {
    error.value = '请先选择文件。'
    return
  }
  loading.value = true
  error.value = ''
  preview.value = null
  try {
    const form = new FormData()
    form.append('file', file.value, fileName.value)
    const res = await request.post('/api/material/import/preview', form)
    preview.value = res.data?.data ?? null
  } catch (e) {
    error.value = e?.response?.data?.msg || e?.message || '解析失败。'
  } finally {
    loading.value = false
  }
}

async function runCommit() {
  const token = preview.value?.token
  if (!token) return
  committing.value = true
  error.value = ''
  try {
    const res = await request.post('/api/material/import/commit', null, { params: { token } })
    result.value = res.data?.data ?? null
    preview.value = null
  } catch (e) {
    error.value = e?.response?.data?.msg || e?.message || '导入失败。'
  } finally {
    committing.value = false
  }
}

function reset() {
  file.value = null
  fileName.value = ''
  preview.value = null
  result.value = null
  error.value = ''
}

export function useMaterialImport() {
  return {
    file,
    fileName,
    preview,
    result,
    loading,
    committing,
    error,
    canPreview,
    canCommit,
    pickFile,
    runPreview,
    runCommit,
    reset,
  }
}
