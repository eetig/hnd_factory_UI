import { createRouter, createWebHistory } from 'vue-router'
import WorkOrderList from '../views/WorkOrderList.vue'
import Login from '../views/Login.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: Login,
    },
    {
      path: '/',
      name: 'WorkOrderList',
      component: WorkOrderList,
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('token')

  if (to.meta.requiresAuth && !token) {
    next({
      path: '/login',
      query: { redirect: to.fullPath },
    })
    return
  }

  if (to.path === '/login' && token) {
    next({ path: '/' })
    return
  }

  next()
})

export default router
