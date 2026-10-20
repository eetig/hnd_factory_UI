import { computed, ref } from 'vue'
import {
  deleteArchive,
  deleteArchiveCategory,
  fetchArchiveCategories,
  listArchive,
  saveArchive,
  saveArchiveCategory,
  uploadArchiveFile,
} from '../api/archive'

/**
 * 资料归档的数据层（变更-126）。
 *
 * <p>与 `usePurchaseTracking` 同一套分工：这里只管「取数 / 存 / 删 / 状态」，
 * 页面只管渲染与交互。错误一律往上抛，由页面决定怎么提示 —— 保存失败时**不清表单**
 * （与采购页同一条：使用者填了一半的内容不该因为一次网络抖动就没了）。
 *
 * <p>筛选条件三个：关键字、分类（含子类，后端处理）、只看 N 天内到期。
 * 「到期」的天数由后端给（`daysToExpire`），前端不自己算日期 —— 口径只有一处。
 */
export function useArchive() {
  const rows = ref([])
  const total = ref(0)
  const loading = ref(false)
  const saving = ref(false)
  const loadError = ref('')

  const pageNum = ref(1)
  const pageSize = ref(20)

  const keyword = ref('')
  const categoryId = ref(null)
  const expireWithinDays = ref(0)

  const categories = ref([])

  /** 当前分类名（列表区顶部那句"正在看哪一类"） */
  const currentCategoryName = computed(() => {
    if (categoryId.value === null) return '全部资料'
    for (const root of categories.value) {
      if (root.id === categoryId.value) return root.name
      for (const child of root.children || []) {
        if (child.id === categoryId.value) return `${root.name} / ${child.name}`
      }
    }
    return '全部资料'
  })

  function buildQuery() {
    const params = { pageNum: pageNum.value, pageSize: pageSize.value }
    if (keyword.value.trim()) params.keyword = keyword.value.trim()
    if (categoryId.value !== null) params.categoryId = categoryId.value
    if (expireWithinDays.value > 0) params.expireWithinDays = expireWithinDays.value
    return params
  }

  async function load() {
    loading.value = true
    loadError.value = ''
    try {
      // ⚠️ request 的拦截器对 success:false 是 reject 的（业务失败也走 HTTP 200），
      // 所以这里不需要再判一次 res.data.success。
      const { data } = await listArchive(buildQuery())
      rows.value = data?.dataList || []
      total.value = data?.total || 0
    } catch (e) {
      loadError.value = e?.response?.data?.msg || e?.message || '加载失败'
      rows.value = []
      total.value = 0
    } finally {
      loading.value = false
    }
  }

  async function loadCategories() {
    try {
      const { data } = await fetchArchiveCategories()
      // ⚠️ 后端这个接口回的是 Result{code,msg,data} 信封（不是裸数组），
      // 列表接口 /list 才是直接回 PageResult —— 两者包装不同，这里必须取 .data。
      // 第一版把信封当数组赋给 categories，computed 里 for...of 直接抛
      // "categories.value is not iterable"，被工作台冒烟测试当场抓住。
      const list = data?.data
      categories.value = Array.isArray(list) ? list : []
    } catch {
      categories.value = []
    }
  }

  function setCategory(id) {
    categoryId.value = id
    pageNum.value = 1
    return load()
  }

  function setKeyword(value) {
    keyword.value = value
    pageNum.value = 1
    return load()
  }

  function setExpireWithin(days) {
    expireWithinDays.value = days
    pageNum.value = 1
    return load()
  }

  function goPage(n) {
    pageNum.value = n
    return load()
  }

  function changePageSize(n) {
    pageSize.value = n
    pageNum.value = 1
    return load()
  }

  /**
   * 保存。
   *
   * <p>成功返回后刷新列表与分类计数 —— 分类树上的数字会变（新增/改分类/换分类都影响它）。
   */
  async function save(form) {
    saving.value = true
    try {
      const { data } = await saveArchive(form)
      await Promise.all([load(), loadCategories()])
      return data
    } finally {
      saving.value = false
    }
  }

  async function remove(id) {
    await deleteArchive(id)
    // 软删只影响"未删"计数，列表与分类计数都要刷
    await Promise.all([load(), loadCategories()])
  }

  async function upload(file) {
    const { data } = await uploadArchiveFile(file)
    // 同样要解信封：Result{code,msg,data} → 真正的 { fileName, origName, size, contentType }
    return data?.data || null
  }

  async function saveCategory(payload) {
    const { data } = await saveArchiveCategory(payload)
    await loadCategories()
    return data
  }

  async function removeCategory(id) {
    await deleteArchiveCategory(id)
    await Promise.all([load(), loadCategories()])
  }

  return {
    rows,
    total,
    loading,
    saving,
    loadError,
    pageNum,
    pageSize,
    keyword,
    categoryId,
    expireWithinDays,
    categories,
    currentCategoryName,
    load,
    loadCategories,
    setCategory,
    setKeyword,
    setExpireWithin,
    goPage,
    changePageSize,
    save,
    remove,
    upload,
    saveCategory,
    removeCategory,
  }
}
