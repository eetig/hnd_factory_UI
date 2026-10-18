<script setup>
import PanelState from '../../components/PanelState.vue'

/*
 * 电费预提（原 WorkOrderList.vue 的 `electricity` 页签）。
 *
 * 上半是电价档位说明（三种阶梯价），下半是占位 —— 真正的预提计算还没接。
 */
</script>

<template>
  <div>
    <section class="rounded-card border border-line bg-raised shadow-card">
      <!-- 电价档位备注 -->
      <div class="border-b border-line bg-amber-50/40 px-6 py-4">
        <div class="flex items-start gap-3">
          <div
            class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-800"
          >
            !
          </div>
          <div class="min-w-0 flex-1">
            <h3 class="text-sm font-semibold text-slate-800">电价档位备注</h3>
            <div class="mt-3 grid gap-3 sm:grid-cols-3">
              <div class="rounded-card border border-amber-200/70 bg-raised px-4 py-2.5">
                <p class="text-xs text-slate-500">10 万度以内</p>
                <p class="mt-1 text-lg font-semibold text-slate-900">
                  1.1 ~ 1.2<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                </p>
              </div>
              <div class="rounded-card border border-amber-200/70 bg-raised px-4 py-2.5">
                <p class="text-xs text-slate-500">20 万度以内</p>
                <p class="mt-1 text-lg font-semibold text-slate-900">
                  0.9 ~ 1<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                </p>
              </div>
              <div class="rounded-card border border-amber-200/70 bg-raised px-4 py-2.5">
                <p class="text-xs text-slate-500">20 万度以上</p>
                <p class="mt-1 text-lg font-semibold text-slate-900">
                  0.72<span class="ml-1 text-xs font-normal text-slate-500">元</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <PanelState type="pending" title="电费预提" description="功能建设中，敬请期待" />
    </section>
  </div>
</template>
