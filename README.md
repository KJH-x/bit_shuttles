# campus-shuttle-board

北京理工大学良乡 ⇄ 中关村（含西山）校园班车时刻表 — 纯静态页面，浏览器本地实时推算，无后端。自动区分工作日/周末时刻表（`isWeekend`/`activeTrips`）。

线上：`https://bitbus.nslc.top`（GitHub `KJH-x/bit_shuttles` → Cloudflare Pages 自动构建）。

> 📐 **架构 / 设计原因 / 改动历史**：见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)（面向 LLM 与后续维护者，务必先读）。

## 功能

- **正在运行（顶部）**：按走廊渲染两条共享轨道（良乡⇄中关村、中关村⇄西山），每条轨道两端站名在条内；上下两条车道各含一条**圆角细条**（承载路况色带）+ **检查点小圆点**（分段 node，不附文字，悬停提示名称），车辆标（胶囊 + 🚌 emoji + 方向 tip）在细条上方运行，**悬停显示**「往xx · 剩余x分钟」（手机端**单点车辆标**同样显示 tooltip）；「显示全部开行详情」按钮在标题行右侧，点击强制展开时间标签 + 各班次进度明细（无运行班次时自动隐藏按钮）；标题自动显示「正在运行 (N)」班次数；**进度详情**按轨道方向排序（中关村发车上/良乡发车下），中关村发车进度条从右往左累加，每条进度条带 **3s 匀速扫描的高亮波纹**（波前高亮渐隐到无，到达当前进度位置渐隐，`prefers-reduced-motion` 下停用）。
- **末班车后运行图保真**：当日最后一班开行 10 分钟后，「即将开行/下一班/PIDS」自动切换到明天时刻表，但运行图仍保留仍在途的末班班次直至到达。
- **工作日 / 周末自动切换**：周六、周日自动展示周末时刻表（头部徽标显示当前时段）。
- **即将开行**：
  - 点击**「即将开行」标题**（内嵌 `⟳`）灰闪一次即刷新：一键重拉余票与实时路况（清空本地缓存 + 立即请求）；**5 分钟冷却**（localStorage `bitbus-refresh-ts`），pages.dev 预览域名跳过冷却；
  - 桌面（≥900px）**按线路四列**：良乡→中关村 / 中关村→良乡 / 中关村→西山 / 西山→中关村；移动端单列堆叠。
  - 每班次三行：①时间·售价·开售状态 ②方向 ③距开行倒计时。
  - **发车后 T+10 分钟内仍显示**：T~T+5「已发车 · 可能还在上车点」，T+5~T+10「已发车」，T+10 后隐藏。
  - 筛选：全部 / 良乡→中关村 / 中关村→良乡 / **除彩虹巴士**。
- **实时路线耗时（高德）**：两个静态链接按钮（良乡→中关村 / 中关村→良乡），区块上方一条灰色虚线分隔；**桌面端**（排除 iPad/Android pad）点击按钮才弹出一个二维码气泡提示用手机扫码打开导航（不再常显）。
- **高德实时路况（`/api/traffic`）**：本地计划任务脚本（`workspace/campus-shuttle-amap-refresh-20260905/amap-refresh.mjs`，Windows 任务计划每 10 分钟）免鉴权拉取 `m.amap.com` driving.json（iPhone UA + Referer，无登录/无 key/无 cookie），SigV4 直写生产 R2 `traffic/live.json`；返回两条直连线路（良乡⇄中关村 36.5/36.8km）的**实时预计耗时 + 三分段路况色带**：
  - **读模式**：`GET /api/traffic`（纯读 Pages Function）→ R2 缓存直出 `{ available, fetchedAt, dirs:{ fwd, rev } }`，前端每 60s 轮询；**无需任何 Pages 环境变量/secret**（本地脚本用自己的 `BITBUS_R2_*` 凭据直写 R2）；
  - **本地刷新脚本**：Pages 不支持 Cron Triggers，故用**本地计划任务**（而非 GitHub Actions）定时拉取并直写 R2；单方向失败保留旧值，双失败不上传（前端回退静态表）；`--dry` 仅拉取不上传；
  - **实时 ETA 仅在数据被拉取后生效**（数据龄 ≤30min，过期自动回退静态耗时表），生效时**所有需运行时间的计算**（运行图 marker 按段位移、预计到达、剩余、PIDS 进度、检查点）自动使用实时值；运行图 `lane--a/c` 的**圆角细条**（`lane__rail`）叠加半透明路况色带（fwd 正向 S1→S2→S3、rev 反向），高德区显示「路况更新于 HH:MM · N 分钟前」；
  - **数据新鲜度（v1.18）**：`/api/traffic` 与 `/api/availability` 均 `Cache-Control: private, no-store`，`sw.js` 对 `/api/*` 一律放行网络，前端 fetch 带 `cache:"no-store"` ——**刷新页面即见新数据，无需 Ctrl+F5**；仍可在「即将开行」右侧点 `⟳` 手动强刷；
  - **只取直连线路**（容差 ±0.3km，无匹配取最小耗时）；**严格丢弃** cost/红绿灯数/路径详情（不输出不存储）；**耗时不再 1 小时封顶**（实时与静态均不截断）。
- **余票实时查询（`/api/availability`）**：Pages Function 带签名访问 BIT 班车预约源站（`hqapp1.bit.edu.cn`），返回每趟余票 `available/total/pct`：
  - **3h 可见窗口**：`0 ≤ 发车-now ≤ 3h` 的付费班次显示具体余票数字，颜色按真实余量（≥15 绿 / 6–14 黄 / ≤5 红）；售罄（余票=0）显示「售罄」红色；
  - **付费 >3h 开售前**：只显示百分比（无具体数字），颜色同样按真实余量；
  - **免费**：始终显示余票量；**彩虹**：不显示任何余量；
  - **主屏**：班次卡右侧两行余票块（占「方向行+倒计时行」高度）——第一行「余N」大数字（38px）、第二行数据龄「数据是x分钟前」，无边框；**逐车独立查询**（最近班次优先，stale-while-revalidate 立刻返缓存）；
  - **PIDS**：固定整数**满载率**列（`100−余票率`，手机端该列在车次左侧，表头桌面+手机均 sticky 冻结）；**等待发车位置显示出发点**（良乡=东校区上车点、中关村=西门上车点）；上车窗口 T-10~T+6（良乡）/T-10~T+5（中关村）显示「开始上车 · 东校区上车点」/「开始上车 · 西门上车点」；
  - **日期切换**：即将开行面板可切换今日 / 昨日（历史快照，R2）/ 明日（未来班次），今日顶部显示**客流对比**红/绿箭头（与同期工作日/周末历史平均比较）；
  - **TTL 缓存**：按阶段差异化（开售瞬间 20s / 常规 3min / 预售 1h / 免费 2h/30min），**R2 为主缓存**（`avail/live/{date}.json` + 逐车 `avail/trip/` 跨设备共享，未过期不碰源站；过期立刻返旧值 + 后台刷新），`Cache-Control: max-age+s-maxage` + SWR；
  - **可见性按当前时刻重算（v1.19）**：各响应出口统一套用 `functions/_shared/ttl.js#applyVisibility`，用缓存中的原始余票 `bookable` 按请求时刻重算 `visible/available`，消除班次跨过 3h 窗口边界后、SWR 刷新前读到旧 null 造成的灰色百分比闪现；
  - **容错**：源站连接重试 3 次后放弃，失败日志写入 R2（`avail/last-failed.json`），响应降级显示「—」；
  - **历史记录**：R2 每日快照保留 7 天，超期折入累计统计（工作日/周末分组，天数加权）。
- **可作为 App 安装（PWA）**：`manifest.webmanifest` 达标（standalone / 图标 / 主题色），浏览器「安装应用」即可添加到桌面。
- **iOS Safari 安装引导**：iOS 非 PWA 模式打开时，完全加载 5 秒后弹出自定义引导（长按地址栏 → 分享 → 添加到主屏幕，默认作为网页 App 打开）；「知道了」后不再打扰（`localStorage`）。
- **可切换二号屏 PIDS（`#/PIDS`）**：顶部「标准屏 / PIDS」一键切换（hash 路由，兼容直接输入 `/#/PIDS`）；全车次一行一趟、紧凑排列，绿色方向箭头 + 目的地圆点 + 方向/开点/状态/位置（等待发车/催促上车/已出发/已到达，文字四色区分；底色区分未发车/运行中/已到达）。
- **西山线路默认隐藏（开关 `ENABLE_XISHAN`）**：往返西山（中关村⇄西山，route d/e）的全部班次在 `schedule-data.js` 中通过 `ENABLE_XISHAN=false` 默认过滤，运行图/即将开行/PIDS 均不展示。**在明确要求启用之前不得展示**；启用时将开关改为 `true` 并按发版清单 bump 版本号。
- **虚拟站点（checkpoint）**：良乡⇄中关村 途经 京良收费站 → 杜家坎收费站 → 六里桥（无实际停靠），直接嵌入运行图中间轨道条（双向时间加权定位：京良 25.4% / 杜家坎 41.4% / 六里桥 62.3%）；「正在运行」列表与 PIDS 均展示位置信息。
- **QQ 内置浏览器提示**：检测到 QQ 内置浏览器（UA 判定 Android/iOS）时，5 秒后提示用系统浏览器打开以获得更好体验，可「知道了」或「复制链接」；QQ 提示优先于 iOS 安装引导（互斥）。
- **离线可看**：Service Worker（`sw.js`）预缓存全部静态资源；断网/弱网时先取缓存，导航失败回退 `/index.html`，时间 API 失败自动降级本机时钟。
- **购票倒计时**：
  - 免费班次（¥0.00）：价格 tag「免费」+ 开售状态「全天可约」，无需抢票。
  - 彩虹巴士：全周可约，无需抢票。
  - 一般班次：开售窗口 `T-1:00:00 ~ T-0:05:00`，「距开售 HH:MM:SS」倒计时；开售 5 分钟内「开售中 · 立即抢」，之后「可能已售罄」，`T-5min` 后「可买不可退」。
- **网络时间同步**：`time.akamai.com`（主）/ `timeapi.io`（备），每 15 分钟重同步，全局用标准时间（UI 顶部徽标只显示「工作日/周末」）。
- **动态刷新**：`setInterval` 每秒 tick，浏览器本地计算。
- 主题：跟随系统 / 浅色 / 深色三态（localStorage，`data-theme` CSS 变量，风格与同工作区其他仓库一致）。

## 文件

| 文件 | 用途 |
| --- | --- |
| `index.html` | 页面结构 |
| `style.css` | 样式（CSS 变量主题、中间轨道、双列布局、QR 气泡、购票徽标、全局按钮） |
| `schedule-data.js` | 时刻表数据 + 运行耗时配置（改这里） |
| `app.js` | 实时推算渲染 |
| `lib/schedule.js` | 纯逻辑（班次状态、购票、耗时插值、格式化、T+10 文案） |
| `lib/time.js` | 网络时间同步 |
| `lib/availability.js` | 余票数据层（拉取 `/api/availability`、日期切换、数字/百分比、配色） |
| `lib/duration-profiles.js` | 高德耗时预测原始数据（邻近插值） |
| `functions/` | Pages Functions：`api/availability.js` + `_shared/`（签名/重试/TTL/R2 历史） |
| `wrangler.toml` | Pages 配置：R2 bucket 绑定 `AVAIL_BUCKET`、vars（窗口/阈值/西山开关） |
| `.dev.vars` | 本地开发 secret（`SCHOOL_SECRET`，已 gitignore，生产用 Pages 环境变量） |
| `assets/qr-*.png` | 高德导航静态二维码（桌面扫码） |
| `tests/` | auto-test（`node --test tests/*.test.mjs`，44 项） |
| `docs/ARCHITECTURE.md` | 架构 / 设计原因 / 改动历史（面向 LLM） |
| `_headers` | Cloudflare Pages 安全头 / 缓存 |
| `meta.json` | 站点元数据（X-B4 约定） |

## 修改耗时

- 耗时表原始预测值保留在 `lib/duration-profiles.js`（含重叠点），按发车时间**邻近插值**。
- **耗时不再封顶**：实时与静态耗时均允许超过 60 分钟；高德实时路况可用时优先用实时值（其余保持静态插值）。灰色小字提示：预测时间仅考虑路况平均拥堵，无法保证突发事件影响，请以实际运行为准。

```js
export const DURATION_MIN = 60;            // 默认耗时（分钟）
export const DURATION_BY_ROUTE = {
  a: 60,                                    // 按线路覆盖：a=良乡→中关村
  c: 60                                     // c=中关村→良乡
};
// 或在某条班次上单独覆盖（不再封顶）：
{ id: "a3", route: "a", dep: "07:30", price: "¥10.00", rainbow: true, dur: 70 }
```

优先级：`trip.dur` > `DURATION_BY_ROUTE[route]` > 耗时表邻近插值 > `DURATION_MIN`，耗时不再封顶；实时路况可用时用实时值（其余保持静态插值）。

## 本地预览与测试

```powershell
# 本地静态预览（ES module 需 HTTP）
python -m http.server 8877 --bind 127.0.0.1   # 打开 http://127.0.0.1:8877/

# 本地全栈预览（含 /api/availability + R2 本地模拟；.dev.vars 提供 SCHOOL_SECRET）
wrangler pages dev . --port 8799              # 打开 http://127.0.0.1:8799/

# auto-test
node --test tests/*.test.mjs
```

## 发版注意

改代码后记得**同步 bump 版本号**（`index.html`、`app.js`、`schedule-data.js` 中的 `?v=20260904-N`、`sw.js` 的 `CACHE_NAME`），否则可能吃到 zone 层旧缓存。详见 `docs/ARCHITECTURE.md` §7。首次启用余票功能需：① Pages 项目绑定 R2 `campus-shuttle-avail`（`wrangler.toml` 已声明）；② 设置生产环境变量 `SCHOOL_SECRET`（Pages secret，勿明文）与 `SCHOOL_SCHEME_ORDER`（默认 `https,http`）。实时路况（v1.17）**无需任何 Pages 环境变量**：本地计划任务脚本用 Windows 用户级 `BITBUS_R2_ACCESS_KEY_ID` / `BITBUS_R2_SECRET_ACCESS_KEY` / `BITBUS_R2_ENDPOINT` / `BITBUS_R2_BUCKET`（专有 key，`R2_*` 为其他项目，勿动）直写 R2 `traffic/live.json`；脚本位于 `workspace/campus-shuttle-amap-refresh-20260905/`，由计划任务「bitbus-amap-refresh」每 10 分钟经 `run-hidden.vbs`（wscript，隐藏窗口、不抢焦点、RegRead 注入凭据）运行，日志追加到 `.opencode/runtime/logs/amap_refresh.log`。

## 部署

GitHub push 到 `main` 即触发 Cloudflare Pages 自动构建（Git 集成，无构建命令、根目录部署）。

## 许可

MIT License。
