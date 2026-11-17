import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'

import ArchiveDetailDrawer from '../../src/components/archive/ArchiveDetailDrawer.vue'

/**
 * 资料抽屉的拖拽归档（2026-11-17，变更-225）。
 *
 * 使用方 m07610 的五条口径，这里逐条钉住：
 *   · 落点是整个抽屉（事件挂在抽屉正文那层，不是「选择文件」按钮）；
 *   · 拖多个 → 落成多条资料（每份一行、各自一个分类）；
 *   · 立刻上传（不等保存，所以关抽屉要先问）；
 *   · 自动填名称 + 用 AI 建议补分类；
 *   · 不合规的一次说清（类型不对 / 超 30MB / 超 20 个）。
 *
 * 上传走父组件（面板）那条线，测试里用 `onUploadBatch` 传结果进来，不打网络。
 */
const CATEGORY = { value: 7, label: '证照与资质' }

function fileOf(name, bytes = 16) {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' })
}

async function mountDrawer(props = {}) {
  const wrapper = mount(ArchiveDetailDrawer, {
    props: {
      modelValue: true,
      mode: 'create',
      row: null,
      canEdit: true,
      saving: false,
      appendToBody: false,
      categoryOptions: [CATEGORY],
      ...props,
    },
    global: { plugins: [ElementPlus] },
  })
  // el-drawer 的内容要等打开动画那一拍才渲染（同 EquipmentDrawer.spec）
  await flushPromises()
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 60))
  return wrapper
}

/** 往抽屉正文那层（整个抽屉就是落点）扔文件 */
async function drop(wrapper, files) {
  await wrapper.find('.min-h-full').trigger('drop', { dataTransfer: { files } })
  await flushPromises()
}

describe('资料抽屉：拖拽归档', () => {
  it('拖进来的文件落在整个抽屉上：拖 1 个进表单，拖多个变多份', async () => {
    const onUpload = vi.fn((file, resolve) => resolve({ fileName: 'store/one.pdf', origName: file.name, size: 16 }))
    const onUploadBatch = vi.fn((files, resolve) =>
      resolve(files.map((f) => ({ ok: true, fileName: `store/${f.name}`, origName: f.name, size: 16 }))),
    )

    const wrapper = await mountDrawer({ onUpload, onUploadBatch })

    // 单份：走老表单（还能填有效期、原件在哪）
    await drop(wrapper, [fileOf('安全许可证.pdf')])
    expect(onUpload).toHaveBeenCalledTimes(1)
    expect(onUploadBatch).not.toHaveBeenCalled()
    expect(wrapper.find('#af-name').element.value).toBe('安全许可证')

    // 再拖两个 → 变批量
    await drop(wrapper, [fileOf('营业执照.pdf'), fileOf('消防验收.pdf')])
    expect(onUploadBatch).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('.adx-batch')).toHaveLength(2)
    expect(wrapper.text()).toContain('保存 2 份')
  })

  it('自动填名称、用 AI 建议补分类，齐全后才发出 save-batch', async () => {
    const onUploadBatch = vi.fn((files, resolve) =>
      resolve(
        files.map((f) => ({
          ok: true,
          fileName: `store/${f.name}`,
          origName: f.name,
          size: 2048,
          contentType: 'application/pdf',
          suggestion: { categoryId: CATEGORY.value, confidence: 'high', name: '', reason: '文件名像证照' },
        })),
      ),
    )
    const wrapper = await mountDrawer({ onUploadBatch })

    await drop(wrapper, [fileOf('安全生产许可证_2026.pdf'), fileOf('特种设备使用登记证.pdf')])

    const names = wrapper
      .findAll('.adx-batch input')
      .filter((node) => /份名称/.test(node.attributes('aria-label') || ''))
      .map((node) => node.element.value)
    expect(names).toEqual(['安全生产许可证 2026', '特种设备使用登记证'])
    expect(wrapper.text()).toContain('AI 置信度高')

    const saveButton = wrapper.findAll('button').find((b) => b.text().includes('保存 2 份'))
    await saveButton.trigger('click')
    await flushPromises()

    const payload = wrapper.emitted('save-batch')?.[0]?.[0]
    expect(payload).toHaveLength(2)
    expect(payload[0]).toMatchObject({
      name: '安全生产许可证 2026',
      categoryId: CATEGORY.value,
      fileName: 'store/安全生产许可证_2026.pdf',
      origName: '安全生产许可证_2026.pdf',
    })
  })

  it('缺分类就点保存：一行都不发，并把「第几条」说清', async () => {
    const warn = vi.spyOn(ElMessage, 'warning')
    const onUploadBatch = vi.fn((files, resolve) =>
      resolve(files.map((f) => ({ ok: true, fileName: `store/${f.name}`, origName: f.name, size: 16 }))),
    )
    const wrapper = await mountDrawer({ onUploadBatch })

    await drop(wrapper, [fileOf('一.pdf'), fileOf('二.pdf')])

    const saveButton = wrapper.findAll('button').find((b) => b.text().includes('保存 2 份'))
    await saveButton.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('save-batch')).toBeUndefined()
    expect(warn).toHaveBeenCalledWith('第 1 条还没选分类')
    expect(wrapper.findAll('.adx-batch.is-bad')).toHaveLength(2)
  })

  it('不合规的文件一次列全：类型不对 + 超 30MB，都不进批量', async () => {
    const alert = vi.spyOn(ElMessageBox, 'alert').mockResolvedValue(true)
    const onUploadBatch = vi.fn((files, resolve) => resolve([]))
    const wrapper = await mountDrawer({ onUploadBatch })

    await drop(wrapper, [
      fileOf('installer.exe'),
      fileOf('大图.pdf', 31 * 1024 * 1024),
      fileOf('正常一.pdf'),
      fileOf('正常二.pdf'),
    ])

    expect(alert).toHaveBeenCalledTimes(1)
    const message = alert.mock.calls[0][0]
    expect(String(message.children)).toContain('installer.exe：类型不支持')
    expect(String(message.children)).toContain('超过 30MB')
    // 只有合规的那一个进了批量
    expect(wrapper.findAll('.adx-batch')).toHaveLength(2)
    expect(onUploadBatch).toHaveBeenCalledTimes(1)
    expect(onUploadBatch.mock.calls[0][0].map((f) => f.name)).toEqual(['正常一.pdf', '正常二.pdf'])
  })

  it('关掉再打开时批量是空的（上一次存完的残留不能串到下一次）', async () => {
    const onUploadBatch = vi.fn((files, resolve) =>
      resolve(files.map((f) => ({ ok: true, fileName: `store/${f.name}`, origName: f.name, size: 16 }))),
    )
    const wrapper = await mountDrawer({ onUploadBatch })

    await drop(wrapper, [fileOf('一.pdf'), fileOf('二.pdf')])
    expect(wrapper.findAll('.adx-batch')).toHaveLength(2)

    await wrapper.setProps({ modelValue: false })
    await flushPromises()
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(wrapper.findAll('.adx-batch')).toHaveLength(0)
  })

  it('批量里还有没落库的资料时，关抽屉要先问一句（否则文件白传）', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))
    const onUploadBatch = vi.fn((files, resolve) =>
      resolve(files.map((f) => ({ ok: true, fileName: `store/${f.name}`, origName: f.name, size: 16 }))),
    )
    const wrapper = await mountDrawer({ onUploadBatch })

    await drop(wrapper, [fileOf('一.pdf'), fileOf('二.pdf')])
    await wrapper.find('button[aria-label="关闭抽屉"]').trigger('click')
    await flushPromises()

    expect(confirm).toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
