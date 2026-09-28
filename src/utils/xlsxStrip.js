import JSZip from 'jszip'

const MEDIA_PREFIX = 'xl/media/'
const CELLIMAGES_PATH = 'xl/cellimages.xml'
const CELLIMAGES_RELS_PATH = 'xl/_rels/cellimages.xml.rels'

// OOXML 关系命名空间（用于取 <a:blip r:embed>）
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/**
 * 剥图：移除 xlsx 内的 xl/media/*（单据图片二进制）后重新打包。
 *
 * 为什么可以剥：预览阶段后端只读单元格里的 DISPIMG("ID_xxx") 文本，
 * 不读图片二进制；图片只在「确认导入」时才需要（见 extractImages）。
 *
 * 实测：16.58MB → 约 0.13MB，预览传输量降 99%。
 *
 * @param {File} file 原始 xlsx
 * @returns {Promise<Blob>} 去掉图片后的 xlsx
 */
export async function stripImages(file) {
  const zip = await JSZip.loadAsync(file)

  Object.keys(zip.files)
    .filter((path) => path.startsWith(MEDIA_PREFIX))
    .forEach((path) => zip.remove(path))

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
}

/**
 * 按需取图：从原始 xlsx 中提取指定 dispimgId 对应的图片。
 *
 * 只解析 zip 结构与两个 XML，不解析 Excel 内容：
 *   xl/cellimages.xml            <xdr:cNvPr name="ID_xxx"/> + <a:blip r:embed="rId1"/>
 *   xl/_rels/cellimages.xml.rels rId1 -> media/image9.jpeg
 *
 * @param {File} file 原始 xlsx（必须是未剥图的，内存中保留的那份）
 * @param {string[]} ids 需要提取的 dispimgId 列表（来自预览接口的 needImageIds）
 * @returns {Promise<File[]>} 文件名 = dispimgId（后端按此匹配），扩展名保留原样
 */
export async function extractImages(file, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return []

  const zip = await JSZip.loadAsync(file)
  const cellImagesEntry = zip.file(CELLIMAGES_PATH)
  const relsEntry = zip.file(CELLIMAGES_RELS_PATH)

  // 该文件没有内嵌图片
  if (!cellImagesEntry || !relsEntry) return []

  const idToRid = parseIdToRid(await cellImagesEntry.async('string'))
  const ridToTarget = parseRidToTarget(await relsEntry.async('string'))

  const images = []

  for (const id of ids) {
    const target = ridToTarget[idToRid[id]]
    if (!target) continue

    // Target 可能是相对路径（media/image9.jpeg）或绝对路径（/xl/media/image9.jpeg）
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const entry = zip.file(path)
    if (!entry) continue

    const bytes = await entry.async('uint8array')
    const ext = path.split('.').pop() || 'jpg'

    // 文件名必须是 dispimgId —— 后端去掉扩展名后作为匹配键
    images.push(new File([bytes], `${id}.${ext}`))
  }

  return images
}

// <xdr:cNvPr name="ID_xxx"> 与同 pic 内的 <a:blip r:embed="rId1"> 配对
function parseIdToRid(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const map = {}

  for (const pic of doc.getElementsByTagNameNS('*', 'pic')) {
    const name = pic.getElementsByTagNameNS('*', 'cNvPr')[0]?.getAttribute('name')
    const embed = pic
      .getElementsByTagNameNS('*', 'blip')[0]
      ?.getAttributeNS(REL_NS, 'embed')

    if (name && embed) map[name] = embed
  }

  return map
}

// <Relationship Id="rId1" Target="media/image9.jpeg"/>
function parseRidToTarget(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const map = {}

  for (const rel of doc.getElementsByTagName('Relationship')) {
    const id = rel.getAttribute('Id')
    const target = rel.getAttribute('Target')
    if (id && target) map[id] = target
  }

  return map
}
