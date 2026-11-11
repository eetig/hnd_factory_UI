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
