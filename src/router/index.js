import { createRouter, createWebHistory } from 'vue-router'
import WorkOrderList from '../views/WorkOrderList.vue'
import Login from '../views/Login.vue'
import { isLoggedIn } from '../api/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: Login,
    },
    {
      // 默认不需要登录：只读浏览对所有人开放。
      // 「写入数据库」的功能（文件导入、图片解析、工单图片上传/删除）
      // 由页面内按权限显隐控制，不在这里拦。
      path: '/',
      name: 'WorkOrderList',
      component: WorkOrderList,
    },
  ],
})

router.beforeEach((to, from, next) => {
  // 已登录时不再停留在登录页
  if (to.path === '/login' && isLoggedIn()) {
    next({ path: '/' })
    return
  }
  next()
})

export default router
