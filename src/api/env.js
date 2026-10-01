// 后端环境预设：一套代码，两套配置（本机联调 / 线上部署）。
//
// 这是**唯一的开关**。改 APP_ENV 一处，三端（H5 / App / 小程序）的
// 接口、图片、OCR 会一起切换 —— vite.config.js 的 H5 开发代理也读这里，
// 避免出现「前端切了、代理没切」这种只在一端才暴露的错配。
//
// 为什么不做成运行时可切换（App 里选环境）：
// origin 在编译期就被内联进产物，运行时切换要引入动态配置下发；
// 每个环境各打一个包更简单，也少一个「装成联调包」的失效点。
//
// 本文件刻意不写 uni-app 条件编译（// #ifdef 等），因为 vite.config.js
// 要在 Node 里 import 它 —— 条件编译只有 uni 的编译器认得，Node 不认。

/**
 * 当前环境：
 *   'local'  —— 本机/局域网后端联调（跑在自己的开发机上，手机需与电脑同网段）
 *   'remote' —— 线上部署（hbhnd.cloud）
 *
 * ⚠️ **打正式包（APK / 小程序提审）前必须确认这里是 'remote'**，
 *    否则就是「装到手机上却连的是开发机」—— 正是这次要修的问题
 *    （产物里内联了开发机 IP，见 src/api/config.js 的 API_ORIGIN）。
 */
export const APP_ENV = 'local'

/**
 * 开发机（跑 hnd_factory / img-service / myocr 的那台）的局域网 IP。
 * 手机与电脑必须在同一网段，App 真机才能直连；换网络后要改这里（cmd 里 ipconfig 查）。
 */
const LAN_HOST = '172.26.20.69'

/** 本机联调：局域网直连三台服务 */
const LOCAL_ENV = {
  label: '本机联调（局域网直连三台服务）',
  // hnd_factory：业务接口 /api/*
  apiOrigin: `http://${LAN_HOST}:8084`,
  // img-service：单据图片。直连它时没有 Nginx 做路径路由，
  // /files、/thumbs 要手工重写成它的真实路径（见 imgRewrite）
  imgOrigin: `http://${LAN_HOST}:8082`,
  imgRewrite: true,
  // myocr：图片识别 /api/ocr/*。路径本身就是 /api/ocr/xxx，无需重写
  ocrOrigin: `http://${LAN_HOST}:8085`,
}

/** 线上部署：hbhnd.cloud 同源入口 */
const REMOTE_ENV = {
  label: '线上部署（hbhnd.cloud 同源入口）',
  // ⚠️ 必须走域名，不能换成 124.220.60.154:9091：
  //    9091 只是 hnd_factory 的直连端口，上面没有 /files、/thumbs、
  //    /api/ocr 三条路由（已实测三者均 404），而域名侧 Nginx 把它们
  //    分别转给了 img-service 与 myocr。
  //    想直连 9091 调后端接口时，请用 curl/Postman，不要改这里。
  apiOrigin: 'https://hbhnd.cloud',
  // 域名侧 Nginx 已把 /files、/thumbs 同源路由到 img-service，
  // 留空即「跟随 apiOrigin」且不做重写，与改造前 H5 的行为一致
  imgOrigin: '',
  imgRewrite: false,
  // /api/ocr 同样由域名侧 Nginx 分流到 myocr，留空即跟随 apiOrigin
  ocrOrigin: '',
}

/**
 * 当前生效的预设。
 *
 * 这里刻意写成「常量比较 + 三元」而不是 `预设表[APP_ENV]`：
 * 后者对打包器是动态取属性，整个预设表都会被保留，
 * 于是**开发机 IP 会照样进正式包**（字符串在产物里，一 grep 就以为没切干净）。
 * 现在这样写，非当前环境的那一份是纯静态不可达分支，
 * 会被 minify 直接删掉 —— 正式包里不会再有本机地址。
 */
export const ACTIVE_ENV = APP_ENV === 'local' ? LOCAL_ENV : REMOTE_ENV
