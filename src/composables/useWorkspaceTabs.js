import { computed, reactive } from 'vue'

/*
 * 全局页签（2026-11-11，照 DSH 客户端重构）。
 *
 * 与「组内页签」的区别：组内页签只列**同一大类**的页，作用是「在工单里换表」；
 * 这里是**工作区页签**，列你打开过的任意页，作用是「在采购和物料之间来回跳」。
 *
 * 存在 sessionStorage：刷新不丢，关浏览器就忘 —— 这是台账系统的口径，
 * 让人明天打开还是从默认页开始，而不是接昨天那堆标签。
 */

const STORAGE_KEY = 'hnd-workspace-tabs'
const MAX_TABS = 12

const state = reactive({ tabs: [], activeKey: '' })
let restored = false

function readStored() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list.filter((t) => t && t.key && t.path) : []
  } catch {
    return []
  }
}

function persist() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.tabs))
  } catch {
    // 隐私模式下存不进去，只是刷新后页签归零，不影响使用
  }
}

/** 恢复上一次的页签（只做一次） */
export function restoreTabs() {
  if (restored) return
  restored = true
  state.tabs = readStored().slice(0, MAX_TABS)
}

export function openTab(item) {
  if (!item?.key || !item?.path) return
  const existing = state.tabs.find((t) => t.key === item.key)
  if (existing) {
    existing.label = item.label
    existing.path = item.path
    existing.group = item.group
  } else {
    state.tabs = [...state.tabs, { key: item.key, label: item.label, path: item.path, group: item.group }]
    // 超出上限时丢最旧的非当前项
    if (state.tabs.length > MAX_TABS) {
      state.tabs = state.tabs.slice(state.tabs.length - MAX_TABS)
    }
  }
  state.activeKey = item.key
  persist()
}

export function setActiveTab(key) {
  if (!key || state.activeKey === key) return
  if (!state.tabs.some((t) => t.key === key)) return
  state.activeKey = key
  persist()
}

/**
 * 关页签。返回「关完之后该去哪」的 key（由调用方决定是否跳转）——
 * 状态模块不碰路由，避免和 router 互相 import。
 */
export function closeTab(key) {
  const index = state.tabs.findIndex((t) => t.key === key)
  if (index < 0) return null
  const wasActive = state.activeKey === key
  state.tabs = state.tabs.filter((t) => t.key !== key)
  let next = null
  if (wasActive) {
    const neighbour = state.tabs[index] || state.tabs[index - 1] || null
    next = neighbour?.key || null
    state.activeKey = next || ''
  }
  persist()
  return next
}

export function clearTabs() {
  state.tabs = []
  state.activeKey = ''
  persist()
}

export function useWorkspaceTabs() {
  restoreTabs()
  return {
    tabs: computed(() => state.tabs),
    activeKey: computed(() => state.activeKey),
    openTab,
    closeTab,
    setActiveTab,
    clearTabs,
  }
}
