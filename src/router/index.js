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
    {
      /*
       * 内部推广落地页。给厂内同事与领导的导览页，不是工作台的一部分。
       *
       * 用**懒加载**：这一页要引用三张截图资源，且与工作台的首屏毫无关系。
       * 静态 import 会把它的代码塞进主包，拖慢真正天天要用的工作台。
       */
      path: '/intro',
      name: 'Intro',
      component: () => import('../views/Intro.vue'),
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
