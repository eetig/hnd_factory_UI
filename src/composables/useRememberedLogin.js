/**
 * 「记住账号密码」（2026-11-02 使用方：「记住账号密码，每次都要手动输入太麻烦了」）。
 *
 * 只存本机（uni storage），不上传、不参与任何后端逻辑。
 *
 * ⚠️ 用的是普通存储，不是系统钥匙串（keychain）—— 内部工具、单机自用这个取舍可接受；
 *    换手机、或者这台手机别人也用，就在登录页把勾去掉（界面上写了这句）。
 *
 * 为什么单独一个 composable：
 *    登录页 `pages/login/login.vue` 是**页面级** SFC，这个仓的 app 端构建对它格外敏感
 *    （实测：往这个文件里加内容，`build:app` 就会在 ~2.5s 处静默失败，且日志里没有
 *    文件名/行号；把文件按原字节重写却又能通过）。把逻辑搬到独立文件后，
 *    login.vue 的改动降到"引一个函数 + 调两次"，避开了这个坑。
 */
import { ref } from 'vue'

const REMEMBER_KEY = 'hnd.login.remember.v1'

function read() {
  try {
    const saved = uni.getStorageSync(REMEMBER_KEY)
    return saved && typeof saved === 'object' ? saved : null
  } catch {
    return null
  }
}

export function useRememberedLogin() {
  const username = ref('')
  const password = ref('')
  const remember = ref(true)

  /** 进页面时把上次的账号密码填好（没有就空着） */
  function restore() {
    const saved = read()
    if (!saved) return
    username.value = saved.username || ''
    password.value = saved.password || ''
    remember.value = true
  }

  /** 登录成功后调用：勾了就存，没勾就清掉（登录成功才存，避免把打错的密码留下） */
  function save() {
    try {
      if (remember.value && username.value.trim() && password.value.trim()) {
        uni.setStorageSync(REMEMBER_KEY, {
          username: username.value.trim(),
          password: password.value.trim(),
        })
      } else {
        uni.removeStorageSync(REMEMBER_KEY)
      }
    } catch {
      // 存不进去不影响登录
    }
  }

  return { username, password, remember, restore, save }
}
