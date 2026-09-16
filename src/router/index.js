import { createRouter, createWebHistory } from 'vue-router'
import WorkOrderList from '../views/WorkOrderList.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'WorkOrderList',
      component: WorkOrderList,
    },
  ],
})

export default router
