# campus-shuttle-board — 架构与设计文档（面向 LLM / 后续维护者）

> 本文件供 LLM 或维护者快速理解**页面结构、功能设计原因与完整改动历史**，避免重复摸索。
> 配套：`README.md`（操作手册）、`tests/schedule.test.mjs`（纯逻辑行为契约）。

## 1. 一句话定位

北京理工大学「良乡 ⇄ 中关村」工作日校园班车的**纯静态实时页面**：浏览器本地每秒推算班次状态（未发车 / 已发车 / 运行中），无后端、无 R2、无 Worker，托管于 Cloudflare Pages（`https://bitbus.nslc.top`，GitHub `KJH-x/bit_shuttles` push 自动构建）。

## 2. 页面结构（自上而下）

```
site-header
  hero__row: 标题 + 实时时钟（走网络时间，无同步徽标）
toolbar: 下一班状态 + 主题切换（system/light/dark）
panel「正在运行」
  route-track__lanes（相对定位容器）
    route-track__bar   ← 居中圆角矩形，两端文字「良乡 / 中关村」塞在条内
    lane--c            ← 上车道（中关村→良乡），背景透明，仅承载车辆标
    lane--a            ← 下车道（良乡→中关村），背景透明，仅承载车辆标
    → bus-marker：胶囊 pill + 🚌 emoji（反向旋转180°）+ 方向 tip + hover tooltip
  [显示全部开行详情] 按钮（位于轨道下方，点击展开各班次进度明细）
  running-detail（默认隐藏：各班次独立进度条）
  amap-links
    标签「实时路线耗时（跳转高德导航）」
    两个按钮：良乡→中关村 / 中关村→良乡（手机直接跳高德）
    amap-qr 气泡（仅 ≥900px 桌面显示）：两张静态二维码 + 「电脑端请用手机扫码」
  panel__note：灰色免责声明
panel「即将开行」
  filter-chips：全部 / 良乡→中关村 / 中关村→良乡 / 除彩虹巴士
  trip-columns（≥900px 两列：左=良乡出发，右=中关村出发；<900px 单列堆叠）
    trip-column__title + ul.trip-list
    → trip-item 三行：①时间·售价·开售状态 ②方向 ③距开行倒计时
  empty-state
site-footer：数据说明
```

## 3. 核心数据流与状态机

- **数据源**：`schedule-data.js`（46 班次，route a=良乡→中关村 / c=中关村→良乡）→ `lib/schedule.js` 纯函数推算 → `app.js` 每秒 `tick()` 渲染。
- **耗时**：`tripDuration` 优先级 `trip.dur` > `DURATION_BY_ROUTE[route]` > 耗时表邻近插值（`lib/duration-profiles.js`）> `DURATION_MIN`，最终统一 `Math.min(…, 60)`（`MAX_DURATION_MIN`）。
- **班次状态**：`now < depMs` → `upcoming`；`depMs ≤ now < arrMs` → `running`；否则 `past`。
- **即将开行可见性**（关键规则，T=发车时刻）：
  - `now < T`：正常显示，倒计时「X 后」；
  - `T ≤ now < T+5min`：仍显示，倒计时文案「已发车 · 可能还在上车点」；
  - `T+5min ≤ now < T+10min`：仍显示，倒计时文案「已发车」；
  - `now ≥ T+10min`：从即将开行列表隐藏（`filterUpcoming` 的 `HIDE_AFTER_MS`）。
  - 同时已开行班次若仍在途（≤耗时），会同时出现在顶部「正在运行」区。
- **购票状态**（`ticketInfo`）：
  - 免费（¥0.00）→「全天可约」（价格 tag 已显示「免费」，故不重复）；
  - 彩虹（rainbow=true）→「全周可约」；
  - 一般班次：`T-1h` 开售，倒计时「距开售 HH:MM:SS」；开售后 5 分钟内「开售中 · 立即抢」；之后「可能已售罄」（红）；`T-5min` 后「已停止售票」。

## 4. 时间同步（为何时钟可信）

启动与每 15 分钟调用 `lib/time.js#syncClock()`：先取 `https://time.akamai.com/`（返回 Unix 秒，CORS 通配），失败则回退 `https://timeapi.io/...`，计算 `offset = serverMs - (t0+t1)/2`，全局 `now()` 均叠加该偏差。**UI 不再显示同步徽标**（曾经显示，后按需求移除），但时间校正仍生效。CSP 已在 `_headers` 的 `connect-src` 放行这两个源。

## 5. 为什么这样设计（决策记录）

| 决策 | 原因 |
| --- | --- |
| 运行图=中间单个圆角矩形 | 双向共享一条轨道，视觉简洁；两端站名放进条内，避免顶部单独一行标签 |
| 两条 lane 背景透明但保留 | 车辆标需按方向分上下两行定位；隐藏背景即可露出中间轨道，又不破坏 JS 定位逻辑 |
| 即将开行两列（桌面） | 学生按出发方向浏览更高效；良乡出发在左符合阅读习惯 |
| trip-item 三行 | 移动端一屏信息多，时间/价格/开售一行、方向一行、倒计时一行，避免挤压 |
| 实时路线=高德链接 + 桌面二维码 | 链接静态固定；高德 m 站手机可用但桌面体验差，故桌面给静态二维码让用户扫码用手机导航 |
| 二维码静态打包 | 链接不变，无需运行时生成；`assets/qr-*.png` 用 Python qrcode 一次生成提交 |
| T+10 后才隐藏班次 | 发车后 5 分钟内车可能仍在学校内最后一个上车点，提示「已发车·可能还在上车点」；5~10 分钟显示「已发车」，10 分钟后才从列表消失 |
| 购票 1h 提前开售、5 分钟售罄 | 实测一般班次开售 5 分钟内售罄；免费班次全天可约；彩虹全周可约 |
| 耗时封顶 1 小时 | 公交专用道使班车通常比轿车快，高德轿车预测可超 1h，故统一 `min(…,60)`；原预测值仍保留于 `duration-profiles.js` 供日后校准 |
| 版本化查询串破缓存 | `bitbus.nslc.top` 的 zone 层会把 `_headers` 的 `no-cache` 覆盖为 `max-age=14400`，曾导致「加载中」卡死（旧模块缺新导出）。改发版时统一 bump `index.html`/`app.js`/`schedule-data.js` 里的 `?v=20260901-N` |

## 6. 改动历史

| 版本 | 日期 | 内容 | 提交 |
| --- | --- | --- | --- |
| v1 | 2026-08-31 | 初始静态页：良乡⇄中关村时刻表、顶部共享进度条、即将开行列表、三态主题；含回龙观线路 | `2034b88` |
| v1.1 | 2026-09-01 | 网络时间同步（Akamai/timeapi + 同步徽标）、购票倒计时、双车道进度条（bus pill+emoji+tip+悬停 tooltip）、详情展开按钮、移除回龙观、筛选改「除彩虹巴士」 | `1df54ad` |
| v1.2 | 2026-09-01 | 修生产「加载中」：JS/CSS 改 `no-cache` + 全链 `?v=` 版本化（zone 缓存覆盖根因） | `eab4899`→`9dbcbfc` |
| v1.3 | 2026-09-01 | 良乡→中关村耗时表（邻近插值）；耗时 >1h 一律封顶 60min；高德实时路线正/反向按钮；灰色免责声明；移动端价格/时间独立行 | `3930101` |
| v1.4 | 2026-09-01 | 移动端 7 项修复：免费 tag 去重（ticket 只写「全天可约」）、去掉 ↔、trip-item 三行布局、Amap 按钮同行省略正反向词、移除顶部说明、展开按钮移到轨道下方、删除同步徽标 | `7c21463` |
| v1.5 | 2026-09-02 | 桌面两列（按方向）；桌面 QR 气泡（静态打包二维码）；运行图收敛为中间单圆角矩形（两 lane 透明仅留车辆标）；T+10 才隐藏班次（T~T+5「可能还在上车点」、T+5~T+10「已发车」） | 当前 |
| v1.6 | 2026-09-02 | 周末时刻表（`TRIPS_WEEKEND`，32 班次，含中关村⇄西山 d/e 两条新线路，免费）；`isWeekend`/`activeTrips` 按日期自动切换；运行图改为按走廊（良乡⇄中关村 + 中关村⇄西山）分组渲染；即将开行按 4 条线路分列；修倒计时 <1 分钟误拼「即将后」→「即将发车」；`formatDurationLabel` 亚分钟改为「不足 1 分钟」 | 当前 |
| v1.7 | 2026-09-02 | iOS Safari 非 PWA 安装引导（`lib/install-guide.js`，load 后 5s 弹出：长按地址栏→分享→添加到主屏幕，默认作为网页App打开；localStorage 忽略标记）；QQ 内置浏览器提示（`lib/qq-guide.js`，UA 判定 Android/iOS，5s 后提示换系统浏览器，可「知道了」/「复制链接」）；两者互斥（QQ 优先） | 当前 |
| v1.8 | 2026-09-02 | **二号屏 PIDS**（route `#/PIDS`，hash 路由 + hashchange/pushState 顶部「标准屏 / PIDS」切换）：全车次一行一趟、紧凑排列，方向/开点/状态（等待发车/催促上车/已出发/已到达，文字四色区分；底色三类：未发车 pre / 运行中 run / 已到达 done）；**虚拟站点（checkpoint）**：良乡⇄中关村 途经 京良收费站→杜家坎收费站→六里桥（`CHECKPOINTS`，无实际停靠，`checkpointTimes` 等分估算，待补充精确位置/间距）。注：`_redirects` 200-proxy 会在 CF 端归一化路径并破坏相对资源，故采用 hash 路由 | 当前 |
| v1.9 | 2026-09-02 | **虚拟站点嵌入运行图 bar**：三个检查点标签直接放进中间轨道条内（同两端「良乡/中关村」样式），删除条下方 checkpoint-strip；位置按**双向时间分布加权平均**重算（京良 25.4% / 杜家坎 41.4% / 六里桥 62.3%，`CHECKPOINTS.pos`）；**校内上车点**（`CAMPUS`）：良乡出发 东校区→北校区→南校区（T-10~T+6），中关村出发 西门→南门；**PIDS 增「位置」列**；**发车卡片**：发车后 T~T+6 显示所在上车点、T+6~T+10 显示「已出发」、之后隐藏 | 当前 |
| v1.10 | 2026-09-02 | **各班次进度改为 li 底色**：`running-item` 的 `-━背景渐变`（route 色 + `--pct`）作为进度条，删除原 `__bar/__fill`；**PIDS 首列前增 2 列**（无表头）：左列=左箭头 `←`（往良乡）、右列=右箭头 `→`（往中关村/西山），每行只显示其一，另一列留空；**到达顺序按时间窗口推进**（`arrivalStopAt`）：中关村 南门→西门、良乡 东校区→北校区→南校区，最后停在南校区/西门；删除 PIDS 底部「虚拟站点」说明文字；PIDS 全称 Passenger Information Display System | 当前 |
| v1.11 | 2026-09-02 | **PIDS 窄屏重排 3 列**（≤768px）：第 0 列=方向箭头（左右两列合并为「arrow」区），第 1 列=方向 `A ➡ B`，第 2 列=时间/状态/位置纵向堆叠（grid-template-areas）；窄屏取消 PIDS 外框（panel）两侧边距并改直角（border-radius:0）；**主视图运行图窄屏**：虚拟站点省略「收费站」后缀（仅 京良/杜家坎/六里桥，`.checkpoint-suffix` 隐藏）且底色/文字对调 | 当前 |
| v1.12 | 2026-09-02 | **末班车 T+10 后运行图保真**：`tick()` 双轨计算——`todayAll`（真实当天班次，末班仍在途仍显示）驱动运行图/运行列表，`displayAll`（展示日，滚动到明天）驱动即将开行/下一班/PIDS/徽标；**运行面板标题计数**「正在运行 (N)」，无运行班次时隐藏「显示全部开行详情」按钮（`detailToggle.hidden`），删除运行 hint；**运行标题下侧双 margin（4+8px）清零**（仅作用 `aria-labelledby="runningTitle"` 面板）；**高德二维码改为桌面点击弹泡**：`isDesktopDevice()`（hover:hover+pointer:fine，排除 iPad-like/Android pad）判定桌面端，`bindAmapQr()` 点击按钮 preventDefault 后给 `#amapQr` 加 `.amap-qr--open` 并仅显示对应 `data-qr=fwd/rev` 二维码，默认 `.amap-qr{display:none}`（移除 ≥900px 常显）；**高德区上方常显灰虚线**（`border-top:1px dashed`，不藏在 running-detail 内）；**PIDS 隐藏**「共 N 班次」状态与「全车次·一行一趟·状态实时刷新」提示；**手机端 bus-marker 点击显示 tooltip**（click 切换 `.bus-marker--active`，替代 hover） | 当前 |
| v1.13 | 2026-09-04 | **PIDS 按自然日切换**：`renderFids` 改用 `todayAll`（真实当天）驱动，恢复 PIDS 在过凌晨后才换到次日，不再随主页 T+10 提前滚动（主页「即将开行/下一班」仍用 `displayAll` 提前切换，分支见 `tick()`：`renderFids(todayAll)` vs `renderUpcoming/renderStatus(displayAll)`）；**西山线路隐藏开关** `schedule-data.js#ENABLE_XISHAN=false`（默认关闭）：往返西山（route d/e，仅周末 `wd1`/`we1`）全部班次在 `activeTrips()` 被过滤，运行图/即将开行/PIDS 均不展示，直到要求启用前保持隐藏；工作日本无 d/e，直接复用原数组引用 | 当前 |

## 7. 发版 Checklist（防坑）

1. 改数据/样式/逻辑后：`node --test tests/` 全绿。
2. 本地 `python -m http.server 8877`，用浏览器分别验证 ≥900px（两列+QR）与 ≤768px（单列、QR 隐藏、三行卡片）。
3. 统一 bump 版本号：`index.html` 的 `style.css?v=` 与 `app.js?v=`、`app.js` 内部 import、`schedule-data.js` 的 re-export，四处同步改为 `20260902-N+1`（否则可能吃到 zone 层旧缓存）。
4. commit + push `main` → CF Pages 自动构建（无构建命令，根目录部署）。token 无 Zone 权限，无法用 API 查部署状态，直接 curl 验证 `https://bitbus.nslc.top/` 返回 200 且含新版本号。
