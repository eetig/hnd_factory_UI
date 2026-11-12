import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { mount } from '@vue/test-utils'

/*
 * 桌面外壳的护栏（2026-11-11）。
 *
 * 这一层最容易在半年后"悄悄坏掉"：有人把 baseURL 改回 '/'、有人删掉 CORS 白名单、
 * 有人忘了 latest.json 的 content-type —— 三种都会让车间那几十台机器在**没人操作**的情况下
 * 突然全线白屏或永远收不到更新，而本地开发完全正常（浏览器里页面还是同源的）。
 *
 * 所以这里不测"能不能打包"（那要几分钟），只把**一旦改动就必须重新想一遍**的几处钉住。
 */
const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('桌面版外壳的硬约束', () => {
  it('接口地址走 base.js 的分支，网页版仍然是同源', async () => {
    const { API_BASE, IS_DESKTOP, assetUrl } = await import('../../src/api/base')
    // 测试跑在默认 mode 下，不是 desktop
    expect(IS_DESKTOP).toBe(false)
    expect(API_BASE).toBe('')
    // 相对路径原样返回（网页版由 Nginx / vite 代理处理）
    expect(assetUrl('/files/a.jpg')).toBe('/files/a.jpg')
    expect(assetUrl('https://x/a.jpg')).toBe('https://x/a.jpg')
    expect(assetUrl('')).toBe('')
  })

  it('axios 用的是 API_BASE，不是写死的斜杠', () => {
    const source = read('src/api/request.js')
    expect(source).toContain("from './base'")
    expect(source).toContain('baseURL: API_BASE')
    // 回归：曾经写死 baseURL: '/'，桌面版所有请求会打到 tauri.localhost
    expect(source).not.toMatch(/baseURL:\s*'\/'/)
  })

  it('桌面构建用相对路径（否则本地文件下 /assets 会 404）', () => {
    const source = read('vite.config.js')
    expect(source).toContain("mode === 'desktop' ? './' : '/'")
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['build:desktop']).toContain('--mode desktop')
  })

  it('两个版本号保持一致（不一致会让更新器一直认为有新版本）', () => {
    const conf = JSON.parse(read('src-tauri/tauri.conf.json'))
    const pkg = JSON.parse(read('package.json'))
    expect(conf.version).toBe(pkg.version)
  })

  it('更新器配置齐全：地址、公钥、签名产物开关、权限', () => {
    const conf = JSON.parse(read('src-tauri/tauri.conf.json'))
    expect(conf.plugins?.updater?.endpoints?.[0]).toContain('/desktop/latest.json')
    expect(conf.plugins?.updater?.pubkey?.length).toBeGreaterThan(60)
    expect(conf.bundle.createUpdaterArtifacts).toBe(true)

    const caps = JSON.parse(read('src-tauri/capabilities/default.json'))
    expect(caps.permissions).toContain('updater:default')
    expect(caps.permissions).toContain('autostart:default')
  })

  it('发布脚本把 latest.json 标成 application/json', () => {
    const source = read('scripts/publish-desktop.mjs')
    expect(source).toContain('content-type=application/json')
  })

  it('网页版不渲染桌面设置面板（桌面专属入口不能漏到网页上）', async () => {
    const DesktopPanel = (await import('../../src/components/DesktopPanel.vue')).default
    const wrapper = mount(DesktopPanel)
    expect(wrapper.text()).toBe('')
  })

  it('后端有放行 tauri.localhost 的 CORS 配置', () => {
    // 前端仓里也留一条提醒：CORS 在后端仓，删了它会全线白屏
    const backend = 'D:/project/hnd_factory/src/main/java/org/example/config/WebCorsConfig.java'
    if (!fs.existsSync(backend)) {
      // 换电脑/只有前端仓时跳过，不误报
      return
    }
    const source = fs.readFileSync(backend, 'utf8')
    expect(source).toContain('tauri.localhost')
  })
})

describe('桌面能力在网页版里是安全的空实现', () => {
  it('不会去调 Tauri 的 IPC', async () => {
    const mod = await import('../../src/desktop')
    expect(await mod.desktopVersion()).toBe('')
    expect(await mod.autostartOn()).toBe(false)
    expect(await mod.setAutostart(true)).toBe(false)
    expect(await mod.checkUpdate()).toBe(null)
    // 关键：网页里 IS_DESKTOP 为 false 时不能抛 "__TAURI_INTERNALS__ is not defined"
    expect(vi.isMockFunction(mod.desktopVersion)).toBe(false)
  })
})

/*
 * 2026-11-11 第二轮：线上 CORS 预检 403。
 *
 * 现场是"网络通、账号对，界面只有 Network Error"，而浏览器里网页版一切正常 ——
 * 差别只在桌面版的页面来源是 tauri.localhost。两条路都留着：
 *   ① 桌面版改走 Rust 发请求（不经过浏览器的同源策略），立刻能用；
 *   ② 后端补 CORS 白名单（以后真要用 WebView 直连也踏实）。
 */
describe('桌面版绕开浏览器跨域', () => {
  it('桌面版把 axios 的通道换成 Rust，网页版不动', () => {
    const source = read('src/api/request.js')
    expect(source).toContain("from './desktopHttp'")
    expect(source).toContain('IS_DESKTOP ? { adapter: desktopAdapter } : {}')

    const adapter = read('src/api/desktopHttp.js')
    expect(adapter).toContain("from '@tauri-apps/plugin-http'")
    // 连不上时必须带上地址，否则使用者只会看到 Network Error
    expect(adapter).toContain('连不上服务器')
  })

  it('HTTP 白名单只放自家域名，不开通配', () => {
    const caps = JSON.parse(read('src-tauri/capabilities/default.json'))
    const http = caps.permissions.find((p) => typeof p === 'object' && p.identifier === 'http:default')
    expect(http).toBeTruthy()
    const urls = http.allow.map((a) => a.url)
    expect(urls).toContain('https://hbhnd.cloud/**')
    expect(urls.some((u) => u === '**' || u === 'https://**')).toBe(false)
  })

  it('Rust 侧装了 http 插件与托盘，并拦下关闭事件', () => {
    expect(read('src-tauri/Cargo.toml')).toContain('tauri-plugin-http')
    expect(read('src-tauri/Cargo.toml')).toContain('"tray-icon"')

    const lib = read('src-tauri/src/lib.rs')
    expect(lib).toContain('tauri_plugin_http::init()')
    expect(lib).toContain('TrayIconBuilder')
    expect(lib).toContain('app://close-requested')
    expect(lib).toContain('prevent_close')
  })

  it('关闭时先问「退出 / 最小化到托盘」，网页版不注册', () => {
    const source = read('src/desktop/closeBehavior.js')
    expect(source).toContain("listen('app://close-requested'")
    expect(source).toContain('最小化到托盘')
    expect(source).toContain('distinguishCancelAndClose')
    expect(source).toContain('if (!IS_DESKTOP) return')

    // App.vue 负责挂载，但逻辑本身在 desktop/closeBehavior.js（可单测）
    expect(read('src/App.vue')).toContain('installDesktopCloseBehavior')
  })
})

/*
 * 1.0.2 现场事故（2026-11-11）：
 *   桌面版物料查询页报「缺少分页参数 pageNum」——自写 adapter 把 config.params 整个忘了。
 *   网页版由 axios 自己拼查询串，所以一直正常；只有桌面版会踩。
 */
describe('桌面 adapter 必须带上查询参数', () => {
  it('把 params 拼成查询串（含中文与数组）', async () => {
    const { serializeParams } = await import('../../src/api/desktopHttp')

    expect(serializeParams({ pageNum: 1, pageSize: 20 })).toBe('pageNum=1&pageSize=20')
    expect(serializeParams({ keyword: '阀 门' })).toBe('keyword=%E9%98%80%20%E9%97%A8')
    // 空值不发（与 axios 默认一致，避免后端把 "" 当成筛选条件）
    expect(serializeParams({ a: '', b: null, c: undefined, d: 0 })).toBe('d=0')
    // 数组按 axios 默认风格
    expect(serializeParams({ statuses: ['A', 'B'] })).toBe('statuses%5B%5D=A&statuses%5B%5D=B')
    expect(serializeParams(null)).toBe('')
  })

  it('adapter 里确实用了它（而不是只拼 baseURL 和 url）', () => {
    const source = read('src/api/desktopHttp.js')
    expect(source).toContain('serializeParams(config.params)')
    // 回归：1.0.2 里这里只有 `return base + url`，params 被丢掉
    expect(source).not.toMatch(/return base \+ \(url\.startsWith/)
  })
})

describe('关闭询问的两个动作都不能静默失败', () => {
  it('hide / exit 失败要提示，不能和"用户点了取消"共用一个 catch', () => {
    const source = read('src/desktop/closeBehavior.js')
    expect(source).toContain("await win.hide()")
    expect(source).toContain("ElMessage.error(`收不到托盘")
    expect(source).toContain("ElMessage.error(`退不出去")
    // 权限：窗口收起、进程退出必须显式放行
    const caps = JSON.parse(read('src-tauri/capabilities/default.json'))
    expect(caps.permissions).toContain('core:window:allow-hide')
    expect(caps.permissions).toContain('process:allow-exit')
  })
})

/*
 * 2026-11-11 第三轮（使用方原话）：
 *   「记住选择，最小化到后台，点击关闭就是直接最小化，不弹出提示窗口。这个设置可在设置中修改」
 * 默认必须是不弹窗直接收起 —— 车间电脑上这是挂机程序，多点一次都是噪音。
 */
describe('关闭按钮默认直接收起，偏好可改', () => {
  it('没设置过时默认 minimize，而不是 ask', async () => {
    localStorage.clear()
    const { getCloseAction, setCloseAction, CLOSE_ACTIONS } = await import(
      '../../src/desktop/closePreference'
    )
    expect(getCloseAction()).toBe('minimize')
    expect(CLOSE_ACTIONS.map((c) => c.value)).toEqual(['minimize', 'quit', 'ask'])

    setCloseAction('ask')
    expect(getCloseAction()).toBe('ask')
    // 存了脏值也要能回到默认，不能让窗口打不开
    localStorage.setItem('hnd-desktop-close-action', 'wat')
    expect(getCloseAction()).toBe('minimize')
    expect(setCloseAction('nope')).toBe('minimize')
    localStorage.clear()
  })

  it('closeBehavior 先看偏好，只有 ask 才弹窗', () => {
    const source = read('src/desktop/closeBehavior.js')
    expect(source).toContain("from './closePreference'")
    expect(source).toContain("if (action === 'minimize') return hideToTray()")
    expect(source).toContain("if (action === 'quit') return quitApp()")
    // 弹窗只出现在 ask 分支之后（先认 minimize / quit，剩下的才问）
    const askCall = 'const choice = await askChoice()'
    expect(source).toContain(askCall)
    expect(source.indexOf(askCall)).toBeGreaterThan(source.indexOf("action === 'quit'"))
  })

  it('设置面板里能改（网页版仍然是空的）', async () => {
    const source = read('src/components/DesktopPanel.vue')
    expect(source).toContain('CLOSE_ACTIONS')
    expect(source).toContain('点关闭时')
    expect(source).toContain('setCloseAction')

    const DesktopPanel = (await import('../../src/components/DesktopPanel.vue')).default
    expect(mount(DesktopPanel).text()).toBe('')
  })
})

/*
 * 2026-11-11 第四轮（使用方原话）：
 *   「无边框自定义标题栏…窗口使用 Windows 原生亚克力磨砂…重点强调：毛玻璃是 Tauri 窗口
 *     原生材质，不是前端 CSS 模拟，防止抄表滑动卡顿」
 *
 * 两条硬约束：
 *   ① 材质必须在 Rust 侧申请（window-vibrancy），前端不许用 backdrop-filter；
 *   ② 无边框之后，拖动/最小化/最大化/关闭必须自己接上，否则窗口"关不掉也拖不动"。
 */
describe('原生窗口材质与自绘标题栏', () => {
  it('窗口无边框 + 透明，材质由 Rust 申请', () => {
    const conf = JSON.parse(read('src-tauri/tauri.conf.json'))
    const win = conf.app.windows[0]
    expect(win.decorations).toBe(false)
    expect(win.transparent).toBe(true)

    expect(read('src-tauri/Cargo.toml')).toContain('window-vibrancy')
    const lib = read('src-tauri/src/lib.rs')
    expect(lib).toContain('apply_acrylic')
    expect(lib).toContain('apply_mica')
  })

  it('前端不用 backdrop-filter 模拟磨砂（会把长列表滚动拖慢）', () => {
    for (const file of [
      'src/layouts/AppShell.vue',
      'src/components/shell/WindowControls.vue',
      'src/desktop/appearance.js',
    ]) {
      expect(read(file)).not.toMatch(/backdrop-filter/)
    }
  })

  it('顶栏三段窗口动作齐全，且整条能拖窗口', () => {
    // 2026-11-12：标题栏并进导航条之后，拖动区挂在 AppShell 的 header 上，
    // 三个窗口按钮单独拆到 WindowControls.vue。
    expect(read('src/layouts/AppShell.vue')).toContain('data-tauri-drag-region')
    const source = read('src/components/shell/WindowControls.vue')
    expect(source).toContain("aria-label=\"最小化\"")
    expect(source).toContain('maximized ? \'向下还原\' : \'最大化\'')
    expect(source).toContain('aria-label="关闭"')
    // 关闭必须走 win.close()：Rust 侧的 CloseRequested 才会拦下并交给"最小化到托盘 / 退出"
    expect(source).toContain('win.value?.close()')
  })

  it('窗口操作权限已放行（不放行会点了没反应）', () => {
    const caps = JSON.parse(read('src-tauri/capabilities/default.json'))
    for (const perm of [
      'core:window:allow-minimize',
      'core:window:allow-toggle-maximize',
      'core:window:allow-is-maximized',
      'core:window:allow-start-dragging',
    ]) {
      expect(caps.permissions).toContain(perm)
    }
  })

  it('页签缓存用 KeepAlive，切回来不重新加载', () => {
    const source = read('src/layouts/AppShell.vue')
    expect(source).toContain('<KeepAlive :max="8">')
    expect(source).toContain(':key="viewRoute.path"')
  })
})

describe('外观设置（壁纸 / 模糊 / 纸面浓度）', () => {
  it('默认有壁纸，关掉就返回空（退回纯亚克力）', async () => {
    const { appearance, wallpaperCss, resetAppearance } = await import('../../src/desktop/appearance')
    resetAppearance()
    expect(appearance.enabled).toBe(true)
    expect(wallpaperCss(appearance)).toContain('gradient')
    expect(wallpaperCss({ ...appearance, enabled: false })).toBe('')
    // 自定义图优先于内置渐变
    expect(wallpaperCss({ ...appearance, custom: 'data:image/jpeg;base64,xx' })).toContain('url("data:image')
    resetAppearance()
  })

  it('设置写进 localStorage，重开能记住', async () => {
    localStorage.clear()
    const mod = await import('../../src/desktop/appearance')
    mod.appearance.blur = 30
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(localStorage.getItem('hnd-desktop-appearance')).toContain('"blur":30')
    mod.resetAppearance()
    localStorage.clear()
  })
})

/*
 * 图片地址（2026-11-11，用户报障「图片还是有问题」）。
 *
 * 桌面版的页面来自 `tauri.localhost`，后端返回的 `/files/x.jpg`、`/thumbs/x.jpg`
 * 都是**相对路径** —— 浏览器会拿它们去 exe 自己身上找，结果整列图全是破图。
 * 视觉上看是"图没了"，实际是一次 404。这类 bug 只会在 exe 里出现，网页版永远正常，
 * 所以必须有一条护栏盯着「所有渲染服务端图片的地方都过 assetUrl」。
 */
describe('桌面版的图片地址：服务端相对路径必须补域名', () => {
  const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8')

  const IMAGE_SITES = [
    'src/components/TankLevelPanel.vue',
    'src/components/ImageGalleryDialog.vue',
    'src/components/ZoomableImage.vue',
    'src/components/PurchaseTrackingPanel.vue',
    'src/components/DeliveryNoteUpload.vue',
    'src/views/orders/InboundList.vue',
    'src/views/orders/PickingList.vue',
    'src/views/ImageParse.vue',
    'src/composables/useVesselList.js',
    'src/utils/image.js',
  ]

  it.each(IMAGE_SITES)('%s 渲染图片前过 assetUrl', (rel) => {
    const src = read(rel)
    expect(src, `${rel} 没引 assetUrl —— 桌面版里这张图会 404`).toContain('assetUrl')
    expect(src).toMatch(/assetUrl\(/)
  })

  it('assetUrl 只动"以 / 开头"的相对路径，绝对地址与 data/blob 原样返回', async () => {
    const { assetUrl } = await import('../../src/api/base')
    expect(assetUrl('https://hbhnd.cloud/files/a.png')).toBe('https://hbhnd.cloud/files/a.png')
    expect(assetUrl('data:image/png;base64,xx')).toBe('data:image/png;base64,xx')
    expect(assetUrl('blob:http://localhost/xx')).toBe('blob:http://localhost/xx')
    expect(assetUrl('')).toBe('')
    expect(assetUrl(null)).toBe(null)
    // 非桌面构建（测试/网页）没有 host，原样返回 —— 网页版行为不变
    expect(assetUrl('/files/a.png')).toBe('/files/a.png')
  })

  it('图片识别页的表格图与本地预览都过 assetUrl', () => {
    const src = read('src/views/ImageParse.vue')
    expect(src).not.toMatch(/:src="image\.url"/)
    expect(src).toContain('assetUrl(image.url)')
  })

  it('设备底图：纯文件名走内置资源，不再被补成域名', () => {
    const src = read('src/composables/useVesselList.js')
    expect(src).toContain("fileName.startsWith('/')")
    expect(src).toContain('return assetUrl(fileName)')
  })
})
