import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 关闭行为（2026-11-21，1.0.44）。
 *
 * 背景：1.0.44 之前点标题栏 ✕ 完全没反应 —— capabilities 少一条 allow-close，
 * IPC 被 Tauri 的 ACL 拒了，又被 WindowControls 的空 catch 吞掉。
 * 这里钉住三件事：
 *   1. 收进托盘前，第一次必须解释一句「收到托盘了，不是退出」（否则窗口一没，用户以为死了）；
 *   2. 解释只来一次，之后照旧安静收起（车间电脑上多点一次都是噪音）；
 *   3. 用户把说明框关掉也照样收起，收起失败必须喊出声。
 */

const hide = vi.fn()
const quit = vi.fn()
const error = vi.fn()
const alert = vi.fn()
const confirm = vi.fn()

vi.mock('element-plus', () => ({
  ElMessage: { error: (...args) => error(...args), success: () => {} },
  ElMessageBox: {
    alert: (...args) => alert(...args),
    confirm: (...args) => confirm(...args),
  },
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide }) }))
vi.mock('@tauri-apps/plugin-process', () => ({ exit: (...args) => quit(...args) }))

const HINT_KEY = 'hnd-desktop-tray-hint-shown'

const load = () => import('../../src/desktop/closeBehavior')

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  hide.mockResolvedValue(undefined)
  quit.mockResolvedValue(undefined)
  alert.mockResolvedValue('confirm')
})

describe('收进托盘前第一次解释一句', () => {
  it('第一次 minimize：先解释，再收起，并记住已经解释过', async () => {
    const { performClose } = await load()
    await expect(performClose('minimize')).resolves.toBe(true)

    expect(alert).toHaveBeenCalledTimes(1)
    const [content, title] = alert.mock.calls[0]
    expect(title).toContain('托盘')
    expect(content).toContain('右下角托盘')
    // 文案要说清"左键点图标回来"，不然用户以为程序退出了
    expect(content).toContain('左键')
    expect(hide).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(HINT_KEY)).toBe('1')
  })

  it('第二次 minimize：不再弹窗，直接收起', async () => {
    localStorage.setItem(HINT_KEY, '1')
    const { performClose } = await load()
    await performClose('minimize')

    expect(alert).not.toHaveBeenCalled()
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('用户把说明框关掉（Esc / ✕）也照样收起', async () => {
    alert.mockRejectedValueOnce('close')
    const { performClose } = await load()
    await expect(performClose('minimize')).resolves.toBe(true)

    expect(hide).toHaveBeenCalledTimes(1)
    // 关掉也算看过，不能每次点 ✕ 都挡一层
    expect(localStorage.getItem(HINT_KEY)).toBe('1')
  })
})

describe('其它关闭方式不该被这句说明挡住', () => {
  it('quit：直接退，不弹托盘说明', async () => {
    const { performClose } = await load()
    await performClose('quit')

    expect(alert).not.toHaveBeenCalled()
    expect(quit).toHaveBeenCalledWith(0)
    expect(hide).not.toHaveBeenCalled()
  })

  it('ask + 选「最小化到托盘」：收起，但不再插一句说明', async () => {
    confirm.mockResolvedValueOnce('confirm')
    const { performClose } = await load()
    await performClose('ask')

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(alert).not.toHaveBeenCalled()
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('ask + 点询问框的 ✕：什么都不做，窗口留着', async () => {
    confirm.mockRejectedValueOnce('close')
    const { performClose } = await load()
    await expect(performClose('ask')).resolves.toBe(false)

    expect(hide).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })
})

describe('失败必须喊出来（1.0.2 的教训又犯了一次）', () => {
  it('hide 失败：提示「收不到托盘」，返回 false 而不是静默', async () => {
    localStorage.setItem(HINT_KEY, '1')
    hide.mockRejectedValueOnce(new Error('denied'))
    const { hideToTray } = await load()

    await expect(hideToTray()).resolves.toBe(false)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toContain('收不到托盘')
  })

  it('exit 失败：提示「退不出去」', async () => {
    quit.mockRejectedValueOnce(new Error('nope'))
    const { quitApp } = await load()

    await expect(quitApp()).resolves.toBe(false)
    expect(error.mock.calls[0][0]).toContain('退不出去')
  })

  it('网页版不注册关闭事件（IS_DESKTOP 为假）', async () => {
    const { installDesktopCloseBehavior } = await load()
    const { listen } = await import('@tauri-apps/api/event')
    await installDesktopCloseBehavior()
    expect(listen).not.toHaveBeenCalled()
  })
})
