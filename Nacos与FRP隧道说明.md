# Nacos 与 FRP 隧道说明

> **用途**：回答两个运维问题 ——「Nacos 现在走 stcp，要不要改成 TCP？」「还需要哪些 Nacos 资料？」
> **实测日期**：2026-10-01，实测点 = 开发机 `172.26.20.69`（Windows，`PC-20260607TECG`）
> **适用对象**：运维（FRP / 1Panel / Nginx）、业务后端、新增服务；**前端不涉及**
> **相关文档**：`UNIAPP迁移说明.md` 第 10 节、`前后端改动统筹.md` 变更-004 / 变更-005、`minio同步手册.md`

---

## 1. 结论先行

| 问题 | 结论 |
|---|---|
| Nacos 的 `stcp` 要不要改成 `tcp`？ | **不要改。** 只是「想打开 Nacos 控制台」→ 继续用 `stcp`，在自己这边补一个 visitor 即可（见 §4.1）；想「让别的机器注册进来」→ 那是用法错了，见 §4.2 |
| 现在不改会出问题吗？ | **不会。** 每个环境（本机 / 线上）的服务各自注册在该环境内的 Nacos 上，跨环境不需要注册发现 |
| 还需要哪些 Nacos 资料？ | 见 §6 清单。**前端一条都不需要** —— 前端只经 `https://hbhnd.cloud` 走 HTTP |
| 最该先确认的 | **「线上」那套后端到底跑在哪台机器、数据库在哪、有没有备份**（见 §8），这决定后面所有运维动作 |

一句话：**Nacos 是「内网组件」，不是「公网服务」**。Nacos 官方文档原话：

> Nacos 定义为一个 IDC 内部应用组件，并非面向公网环境的产品，建议在内部隔离网络环境中部署，**强烈不建议**部署在公共网络环境。

所以方向不是「把 stcp 换成 tcp 让它更好连」，而是「**根本不需要连**」。

---

## 2. 实测现状（2026-10-01）

### 2.1 公网端口连通性（从开发机实测）

| 目标 | 结果 | 说明 |
|---|---|---|
| `124.220.60.154:8084`（hnd_factory） | ✅ 通，`200` + `application/json` | FRP 面板上名为 `hnd_factory` 的 TCP 代理占用此端口 |
| `124.220.60.154:8082`（img-service） | ✅ 通 | FRP 代理 `img-service` |
| `124.220.60.154:8085`（myocr） | ✅ 通（OCR `/api/ocr/health` → `200`） | FRP 代理 `myocr` |
| `124.220.60.154:9091` | ✅ 通，仅 `/api/*`（其余 404，`Server: openresty`） | 云上 OpenResty 的另一种入口，后端与 8084 **同一套**（返回数据一致） |
| `124.220.60.154:8848`（Nacos HTTP） | ❌ **不通** | 与面板一致：该 Nacos 走 `stcp`，服务端**不会**开公网端口 |
| `124.220.60.154:9848`（Nacos gRPC） | ❌ **不通** | 同上 |
| `124.220.60.154:8080`（Nacos 3.x 控制台） | ❌ **不通** | 同上 |

> 结论：**公网上只有业务端口**（8082 / 8084 / 8085 / 9091），Nacos 没有对公网开放任何端口 —— 这正是 `stcp` 的设计效果。

### 2.2 开发机本机的 Nacos（`127.0.0.1:8848`）

| 项 | 实测值 |
|---|---|
| 版本 | **2.5.4**（`GET /nacos/v1/console/server/state` → `"version":"2.5.4"`）|
| 模式 | `standalone`（单机）|
| 鉴权 | **`auth_enabled: false`**、`login_page_enabled: false` —— 控制台**不需要登录**，谁连上谁能改 |
| 监听端口 | `8848`（HTTP/控制台）、`9848`、`9849`（gRPC）|
| 已注册服务（4 个） | `hnd_factory` / `img-service` / `myocr` / `excel-import-service` |
| 注册用的 IP:PORT | **`172.26.20.69:8084` / `:8082` / `:8085` / `:8083`** —— 全是**局域网 IP** |

最后一行是本文最关键的一条：**实例注册的是局域网 IP**。任何不在这个局域网里的消费者（云主机、别的办公室的机器）拿到这个地址后**永远连不上**（Feign 调用超时 / 502）。这就是「共用一个 Nacos」在这套拓扑里走不通的根本原因，跟 stcp/tcp 无关。

**线上那套（1Panel 容器里的 Nacos）** —— 本次只为「接账密」留好了位置，事实待运维确认：

| 项 | 现状 | 为什么重要 |
|---|---|---|
| 所在位置 | 1Panel 容器 `1Panel-nacos-qquH-standalone`（外网不开放任何端口）| 与四个后端服务在同一台云主机上 |
| 鉴权 | **待确认**（见 §9 第 0 步）| 若 `auth_enabled=true`，不配账密的客户端会 **403**，四个服务会一起起不来 |
| 账密 | 已按 `NACOS_USERNAME` / `NACOS_PASSWORD` 两个环境变量接入（4 服务 × 2 套配置）| 本机未开鉴权 → 默认留空，行为不变 |
| 控制台端口 | 2.x 在 `8848/nacos`；3.x 是独立的 `8080` | 别把 8080 当成服务注册端口 |

> 「本机能跑、线上 403」是这套拓扑里最典型的坑：本机 `auth_enabled=false`，线上未必。
> 所以**上线前先确认线上鉴权状态**，再决定要不要注入账密。

### 2.3 FRP 面板（`124.220.60.154`）看到的信息

| 项 | 观察 |
|---|---|
| 客户端 | `a0ed1e5e250fe895` / Windows / `111.60.49.8`（家宽 / 办公网出口），已连接 5 小时 |
| 代理数 | 15 个（`1panel` `express_serve` `frpc` `hnd_factory` `img-service` `myocr` … 均为 TCP，带 `Port: xxxx`）|
| `nacos-admin-stcp` | 类型 `STCP`，**不显示 Port**（stcp 本来就不占公网端口），`Connections: 0` |

> 面板无法判断这条 stcp 映射的是 8848（Nacos 2.x 服务 + 控制台）还是 8080（3.x 独立控制台）——
> **请到 frpc 配置里看 `localPort`**。名字叫 `nacos-admin`，大概率是**给人看控制台用的**，
> 若是如此，它与服务注册**完全无关**，更没必要改成 TCP。

### 2.4 顺带查实：公网 8084 ≠ 本机 8084

| 请求 | 返回的工单条数 | 首条 id |
|---|---|---|
| `http://124.220.60.154:8084/api/work-order/list` | **594**（连测 3 次一致）| 941 |
| `http://127.0.0.1:8084/api/work-order/list` | **585**（连测 3 次一致）| 940 |

**两条链路的数据不同 ⇒ 公网那套后端不是这台开发机**，它是 FRP 客户端机器上的另一套
`hnd_factory` + 另一套数据库（`hbhnd.cloud/api`、`:9091`、`:8084` 三者返回的是同一套数据）。

> 前端「remote 环境」指向的就是这套数据（见 `UNIAPP迁移说明.md` 10.3）。
> 这一点必须由运维/业务方书面确认：**线上后端与线上库到底在哪台机器上**。

---

## 3. stcp 与 tcp 的区别（先把概念摆平）

| | `tcp` | `stcp`（secret tcp） |
|---|---|---|
| 服务端是否开公网端口 | **开**（`remotePort`），任何能访问 `124.220.60.154:端口` 的人都能连 | **不开**。公网只看到 frps，服务端不监听该端口 |
| 谁能访问 | 全世界（除非在 frps 侧配 `allowUsers` / `allowPorts` / 云安全组白名单）| 只有**持有相同 `serverName` + `sk`（密钥）**的 frpc，且必须以 **visitor** 身份接入 |
| 访问方式 | 直连 `124.220.60.154:remotePort` | 本机跑一个 visitor，访问 `127.0.0.1:<bindPort>` |
| 适合什么 | 对外提供服务的业务端口（本项目 8082 / 8084 / 8085 就是这么做的）| **只给少数人 / 少数机器用的内部端口**（数据库、控制台、注册中心）|

> 也就是说：**现在这条 `nacos-admin-stcp` 是「正确的选择」，不是「待修的配置」。**
> 把它改成 `tcp`，等于把一个**未开鉴权**的注册中心挂到公网上。

---

## 4. 三种诉求分别怎么做

### 4.1 诉求 A：我要在某台电脑上打开 Nacos 控制台 —— 保持 stcp，补一个 visitor

在**需要看控制台的那台机器**的 frpc 配置里追加（发布端一行都不用改）：

```toml
# frpc.toml（新版 toml 写法）
[[visitors]]
name       = "nacos-admin-stcp-visitor"
type       = "stcp"
serverName = "nacos-admin-stcp"   # 必须与发布端 stcp 代理的 name 完全一致
secretKey  = "<与发布端 sk 相同的密钥>"
bindAddr   = "127.0.0.1"
bindPort   = 18080                # 本机监听端口，选个空闲的即可
```

```ini
# frpc.ini（老版本写法，等价）
[nacos_admin_stcp_visitor]
type        = stcp
role        = visitor
server_name = nacos-admin-stcp
sk          = <与发布端 sk 相同的密钥>
bind_addr   = 127.0.0.1
bind_port   = 18080
```

然后浏览器打开 `http://127.0.0.1:18080`。若发布端 `localPort=8848`（Nacos 2.x），
控制台路径是 `http://127.0.0.1:18080/nacos`；若是 Nacos 3.x 的 8080，直接就是根路径。

> 更省事的替代方案：在那台机器上本地操作（远程桌面 / SSH 进去访问 `127.0.0.1:8848`），
> 一条隧道都不用开。

### 4.2 诉求 B：我要让「别的机器」的服务注册进这个 Nacos —— 不要这么做

即使把 stcp 改成 tcp、把 8848 暴露出去，**依然跑不通**，三条理由：

1. **实例 IP 不可达**（§2.2）：注册进去的是 `172.26.20.69` 这类内网地址，
   外网消费者按这个地址去调用必然超时。要修就得给每个服务单独指定对外地址
   （`spring.cloud.nacos.discovery.ip/port`）并各占一个固定公网端口，复杂度远超收益。
2. **Nacos 2.x 客户端还要 gRPC 端口**（见 §5）：只映射 8848 **不够**，
   表现是「服务列表里能看到，但调用全部失败」。
3. **安全**：本机 Nacos `auth_enabled=false`，暴露到公网等于**任何人都能注册假实例劫持流量、
   或改写配置**（随便注册一个 `img-service` 指向自己的机器，业务就会把图片请求发过去）。

正确做法二选一：

| 做法 | 说明 | 推荐度 |
|---|---|---|
| **A. 每个环境各自一个 Nacos** | 本机开发用本机 Nacos，线上用 1Panel 的 Nacos 容器（`1Panel-nacos-qquH-standalone:8848`）。**本项目已经是这样**，什么都不用改 | ★★★★★ |
| B. 真要做跨网络服务发现 | 不走 FRP，改两条隧道 + 固定端口 + 鉴权 + 白名单 + `discovery.ip/port` 覆盖（清单见 §5.2）| ★（除非有强需求）|

**补充（2026-10-01 复盘）：本节结论还有一条更硬的理由。**

除了「用法不对」，物理上也走不通 —— 实例注册的是**局域网 IP**（本机实测 `172.26.20.69:8084`）：
不在这个网段里的消费者拿到这个地址**永远连不上**（Feign 超时 / 502）。
所以「多台机器共用一个 Nacos」不是「配置麻烦」，而是**不成立**；**每个环境各自一个 Nacos** 才是正解，与 stcp/tcp 无关。

另外：鉴权只是第二道门 —— 即便开了鉴权、账密也配上了，跨网络的注册 IP 问题依旧存在。

### 4.3 诉求 C：我要在云主机上部署后端服务，让它注册上云上 Nacos

这是**最常见的真实场景**，而且**完全不需要 FRP**：容器之间用容器名互访。

```yaml
# application-prod.yml 已经是这个默认值，环境变量都不用配
spring:
  cloud:
    nacos:
      discovery:
        server-addr: ${NACOS_SERVER_ADDR:1Panel-nacos-qquH-standalone:8848}
```

> ⚠️ 已知坑（文档里已记过）：**本机跑 `--spring.profiles.active=prod` 会启动失败**，
> 因为 `1Panel-nacos-qquH-standalone` 是容器名，本机 DNS 解析不了。
> 本机调试用默认 profile（`127.0.0.1:8848`）即可。

---

## 5. Nacos 2.x 客户端的端口要求（最容易踩的坑）

### 5.1 端口表

| 端口 | 用途 | 谁需要 |
|---|---|---|
| `8848`（`server.port`）| HTTP OpenAPI；Nacos **2.x** 控制台在 `/nacos` | 客户端必连 |
| **`9848`（`server.port + 1000`）** | **gRPC 长连接（注册 / 订阅 / 推送）** | **客户端必连** |
| `9849`（`server.port + 1001`）| gRPC 服务端之间同步 | 仅集群模式 |
| `7848` | 集群 Raft 通信 | 仅集群模式 |
| `8080` | **Nacos 3.x 独立控制台**（3.0 起控制台鉴权**默认开启**，首次访问需初始化 `nacos` 管理员密码）| 只用控制台的人 |

> 本机实测：`8848` / `9848` / `9849` 三个端口都在监听 → Nacos 2.x 的行为已复现。
> **只把 8848 映射出去，客户端会在 gRPC 阶段失败** —— 典型表现是启动日志里大量 gRPC 重连，
> 或「服务列表里能看到、调用全超时」，非常难查。

### 5.2 若坚持走隧道（不推荐），必须齐备的清单

| 项 | 要求 |
|---|---|
| 端口 | `8848` **和** `9848`（集群再加 `9849` / `7848`），一个都不能少 |
| 端口映射 | 远端端口要与本地保持 **+1000** 关系，例如本地 `8848/9848` → 远端 `18848/19848`（客户端按 `server-addr 的端口 + 1000` 推算 gRPC 端口，映射错位就连不上）|
| 客户端配置 | `spring.cloud.nacos.discovery.server-addr: <公网IP>:18848` |
| 鉴权 | `nacos.core.auth.enabled=true` + 自定义 `nacos.core.auth.plugin.nacos.token.secret.key`（Base64、≥32 字节）+ `server.identity.key/value`；客户端配 `username` / `password` |
| 访问控制 | frps 侧 `allowUsers` / `allowPorts`，云安全组只放行固定来源 IP |
| 注册地址 | 每个服务显式指定 `discovery.ip` / `discovery.port`，否则注册出去的是内网地址 |

---

## 6. 「还需要哪些 Nacos 资料」——部署前索要清单

**给前端（`hnd_factory_UI`）：无。** 前端只走 `https://hbhnd.cloud` 的四条 HTTP 路由，
不连 Nacos（见 `UNIAPP迁移说明.md` 10.1）。

**给后端服务（`hnd_factory` / `img-service` / `myocr` / `excel-import-service`）**，上云时要问清：

| # | 资料 | 为什么必须要 |
|---|---|---|
| 1 | 注册中心地址 + 端口 | 容器内是 `1Panel-nacos-qquH-standalone:8848`；**不要**写 `127.0.0.1`（那是容器自己）|
| 2 | **命名空间 ID**（不是名称）| 用命名空间隔离环境时**必须填 ID**，填名称会静默注册到 `public`，表现为「注册了但找不到服务」|
| 3 | `group` | 默认 `DEFAULT_GROUP`，各服务要一致 |
| 4 | 是否开鉴权 + 用户名 / 密码 | 1Panel 的 Nacos 若开了鉴权，客户端不配账密会 403 |
| 5 | **Nacos 版本（2.x / 3.x）** | 决定控制台端口（`8848/nacos` vs `8080`）与 3.x 的默认鉴权行为 |
| 6 | standalone 还是 cluster | 决定是否需要 `9849` / `7848` |
| 7 | 数据源 | 1Panel 版一般内置 derby 或 MySQL；确认配置中心是否持久化（临时实例本就该重注册，不受影响）|
| 8 | `fail-fast` 期望值 | 生产 `application-prod.yml` 默认 `NACOS_FAIL_FAST=true`：Nacos 不可达**直接启动失败**，语义是「跑起来 = 一定注册上了」。依赖顺序：**先起 Nacos，再起各服务** |
| 9 | 多网卡 / NAT 下的注册 IP | 「服务列表可见但调用 502」时用 `NACOS_REGISTER_IP` 显式指定（两个 `application-prod.yml` 里都留了注释位）|

> 现成答案：本机开发环境的 Nacos = **2.5.4 / standalone / 未开鉴权 / 命名空间空 / `DEFAULT_GROUP`**。
> **本次已落地的部分**：4 个服务的 `application.yml` 与 `application-prod.yml`（共 8 个文件）在 `spring.cloud.nacos` 下加了 `username` / `password`（取环境变量 `NACOS_USERNAME` / `NACOS_PASSWORD`，**留空即不传**）；`excel-import-service/docker-compose.yml` 与两份 `DEPLOY.md` 补了同名模板。
> 注意属性层级：必须写在 `spring.cloud.nacos` 下、与 `discovery` 同级（写法见 `前后端改动统筹.md` 变更-007）。

---

## 7. 验证命令（复制即用）

```bash
# 1) Nacos 是否活着（本机）
curl -s http://127.0.0.1:8848/nacos/v1/console/health/readiness

# 2) 版本 / 模式 / 是否开鉴权
curl -s http://127.0.0.1:8848/nacos/v1/console/server/state

# 3) 已注册服务清单
curl -s "http://127.0.0.1:8848/nacos/v1/ns/service/list?pageNo=1&pageSize=50&namespaceId="

# 4) 某服务注册的 IP:PORT（排查「注册上了却调不通」看这个）
curl -s "http://127.0.0.1:8848/nacos/v1/ns/instance/list?serviceName=hnd_factory&namespaceId="

# 5) 公网侧是否真的没开 Nacos 端口（应当不通）
curl -m 5 http://124.220.60.154:8848/nacos/ ; echo "exit=$?"

# 6) 容器内能否解析并连上云上 Nacos（在 1Panel 里对目标容器执行）
docker exec -it <容器名> sh -c "wget -qO- http://1Panel-nacos-qquH-standalone:8848/nacos/v1/console/health/readiness"
```

---

## 8. 顺带发现的三个风险（建议尽快确认）

**风险 1：线上一整套后端（含数据库）挂在「某台 PC + 家宽 / 办公网 + FRP」上。**
实测公网 `8084/8082/8085` 的数据与开发机不同（§2.4），说明线上后端跑在另一台机器上。
公网可达性依赖：那台 PC 是否开机 → 那条宽带上行是否正常 → frps 是否正常 → 出口是否变。
任意一环出问题，**App / H5 全站不可用**（前端已把域名和这三个端口都指了过去）。

| 待确认 | 期望答案 |
|---|---|
| 线上后端跑在哪台机器？谁维护、能否远程接入？ | |
| 线上 MySQL 在同一台机器吗？备份策略是什么？ | |
| 那台机器与 frps 的可用性监控、掉线告警？ | |
| 是否计划把后端迁到 `124.220.60.154`（1Panel）？迁移后前端地址不变（仍走域名）| |

**风险 2：`nacos-admin-stcp` 对应的 Nacos 若未开鉴权（本机就是 `auth_enabled=false`），
谁拿到 `sk` 谁就能改配置 / 注册假实例。** stcp 挡住了公网，但密钥要当口令管理：
不要贴群里、不要写进仓库；人员变动时轮换 `sk`。
**风险 3：口令复用。** 同一台机器上部署时，很容易把 Nacos 管理员口令与 MySQL root、FRP `sk` 复用一个口令 —— 那样一处泄露等于三处一起失守。建议：三者分开设口令、纳入轮换，且都不进仓库、不贴群里。

---

## 9. 运维 runbook：把四个后端接上带鉴权的 Nacos

> 适用对象：运维（1Panel）/ 后端服务。**前端不涉及**（前端只走 `https://hbhnd.cloud` 的 HTTP 路由）。

### 第 0 步：先确认线上到底开没开鉴权（必须先做）

```bash
# 在云主机上执行；把 <容器名> 换成 1Panel 里的实际名字
docker exec -it <容器名> sh -c "wget -qO- http://127.0.0.1:8848/nacos/v1/console/server/state"
```

看返回值里的两个字段：

| 字段 | 含义 | 接下来做什么 |
|---|---|---|
| `auth_enabled` | `false` → 没开鉴权 | **什么都不用做**：账密留空即可，四个服务行为不变 |
| 同上 | `true` → 已开鉴权 | 继续第 1 步，按顺序做（顺序不能颠倒）|

### 第 0 步补充：开发机侧实测记录（2026-10-01 14:11~14:12）

运维做第 0 步之前，开发机先试着**从公网直连**云 Nacos，两种方式都测了 —— 结论是：**不是账密问题，是网络层根本不通**。

| 方式 | 目标 | 结果 |
|---|---|---|
| ① 不带账号密码 | `124.220.60.154` 的 `8848` / `9848` / `9849` / `8080` / `18848` / `19848`，以及 `hbhnd.cloud:8848` | **全部连不上**（TCP 超时，`curl` 返回 `000`）|
| ① 同上 | `https://hbhnd.cloud/nacos/...`（赌 Nginx 反代）| **404**，没有反代 |
| ② 账号密码（云 Nacos 管理员那套）| 同一批端点，走 `Basic` 头、`POST .../auth/users/login`、`POST .../auth/login` 三条路径 | **同样全部连不上**；TCP 都没建立，请求根本发不出去，因此**无法判断这套口令对不对** |
| 对照组 | 本机 `127.0.0.1:8848`，同一套脚本、同一套工具 | **通**：匿名 `state` 返回 `auth_enabled=false`；`service/list` 返回 `count=4`（`img-service` / `myocr` / `hnd_factory` / `excel-import-service`）|

对照组能拿到 200 与真实 JSON，说明**探测方法本身没问题**，差异只在云侧的网络路径：`nacos-admin-stcp` 是 **stcp（密钥点对点）**，服务端不监听公网端口，必须由持有同一份 `sk` 的 `frpc` 先打洞、再经 visitor 的本地端口访问（见 §2.2、§4.2），所以裸连 `:8848` 必然不通。

**两条可执行结论：**

1. **第 0 步只能在云主机上做**（开发机做不了）：

```bash
# 或直接在 1Panel 里打开该容器的「终端」执行
docker exec -it <容器名> sh -c "wget -qO- http://127.0.0.1:8848/nacos/v1/console/server/state"
# 账密是否有效也在云上验（-d 里的 & 要带引号）
curl -s -X POST "http://127.0.0.1:8848/nacos/v1/auth/users/login" -d "username=<账号>&password=<口令>"
```

2. **开发机要连云 Nacos，只能走现成的 FRP visitor**：让 `frpc` 加载 `nacos-admin-stcp` 的 `visitor` 段（`server_name` / `sk` / `bind_port`），本地会多出一个如 `127.0.0.1:18848` 的端口，改测这个本地端口即可。**不要**图省事把 stcp 改成 tcp 把 8848 暴露到公网：Nacos 客户端还要连 9848 的 gRPC，两个都得开，风险远大于收益。

> 顺带发现：本机 Nacos 上**没有所试的那个账号** —— `POST /nacos/v1/auth/users/login` 的响应体是 `caused: User <账号> not found;`，换成错口令报的仍是同一句，说明该账号只存在于云上 Nacos。因此本机环境也无法用来校验这套口令；这也解释了本机 login 接口为何返回 500（本机 `auth_enabled=false`，鉴权链路整体未启用）。

### 第 1 步：改配置 + 重新构建镜像（**先做**）

四个服务（`hnd_factory` / `img-service` / `myocr` / `excel-import-service`）的配置已就位：`spring.cloud.nacos.username` / `password` 取 `NACOS_USERNAME` / `NACOS_PASSWORD`，默认空。重新构建镜像，但**先别注入环境变量** —— 此时 `auth_enabled` 还是 `false`，不传账密也能正常注册。

### 第 2 步：注入环境变量并重启

在 1Panel 的容器编排里给这 4 个容器加：

```yaml
environment:
  - NACOS_SERVER_ADDR=1Panel-nacos-qquH-standalone:8848
  - NACOS_USERNAME=<运维填入，不要写进仓库>
  - NACOS_PASSWORD=<同上>
```

重启容器，确认四个服务都能正常注册（此时仍未开鉴权，传了账密也会被忽略，属正常）。

### 第 3 步：**最后**才打开鉴权

在 Nacos 侧打开 `auth_enabled=true` 并设置管理员口令（不要与 MySQL root 同口令），然后重启四个服务。

**为什么顺序不能颠倒**：先开鉴权而客户端还没配账密 → 注册 **403**；配合 `NACOS_FAIL_FAST=true` 的语义（`application-prod.yml` 的默认值），服务会**直接启动失败**，表现为容器重启循环。

### 回滚

任一步骤出问题，先把 `auth_enabled` 改回 `false`（客户端传了账密也会被忽略），服务即可恢复到「能注册」的状态，再排查。

### 与前端的关系

**没有关系**：前端不连 Nacos、也不需要任何 Nacos 资料。四个服务怎么注册、注册到哪里，前端侧完全无感（见 `UNIAPP迁移说明.md` 10.1）。
