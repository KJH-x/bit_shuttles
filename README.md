# campus-shuttle-board

北京理工大学良乡 ⇄ 中关村（含西山）校园班车时刻表 — 纯静态页面，浏览器本地实时推算，无后端。自动区分工作日/周末时刻表（`isWeekend`/`activeTrips`）。

线上：`https://bitbus.nslc.top`（GitHub `KJH-x/bit_shuttles` → Cloudflare Pages 自动构建）。

> 📐 **架构 / 设计原因 / 改动历史**：见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)（面向 LLM 与后续维护者，务必先读）。

## 功能

- **正在运行（顶部）**：按走廊渲染两条共享轨道（良乡⇄中关村、中关村⇄西山），每条轨道两端站名在条内；上下两条车道承载车辆标（胶囊 + 🚌 emoji + 方向 tip），**悬停显示**「往xx · 剩余x分钟」；「显示全部开行详情」按钮在轨道下方，点击强制展开时间标签 + 各班次进度明细。
- **工作日 / 周末自动切换**：周六、周日自动展示周末时刻表（头部徽标显示当前时段）。
- **即将开行**：
  - 桌面（≥900px）**按线路四列**：良乡→中关村 / 中关村→良乡 / 中关村→西山 / 西山→中关村；移动端单列堆叠。
  - 每班次三行：①时间·售价·开售状态 ②方向 ③距开行倒计时。
  - **发车后 T+10 分钟内仍显示**：T~T+5「已发车 · 可能还在上车点」，T+5~T+10「已发车」，T+10 后隐藏。
  - 筛选：全部 / 良乡→中关村 / 中关村→良乡 / **除彩虹巴士**。
- **实时路线耗时（高德）**：两个静态链接按钮（良乡→中关村 / 中关村→良乡）；桌面额外显示**静态二维码气泡**，提示用手机扫码打开导航。
- **可作为 App 安装（PWA）**：`manifest.webmanifest` 达标（standalone / 图标 / 主题色），浏览器「安装应用」即可添加到桌面。
- **iOS Safari 安装引导**：iOS 非 PWA 模式打开时，完全加载 5 秒后弹出自定义引导（长按地址栏 → 分享 → 添加到主屏幕，默认作为网页 App 打开）；「知道了」后不再打扰（`localStorage`）。
- **可切换二号屏 PIDS（`#/PIDS`）**：顶部「标准屏 / PIDS」一键切换（hash 路由，兼容直接输入 `/#/PIDS`）；全车次一行一趟、紧凑排列，绿色方向箭头 + 目的地圆点 + 方向/开点/状态/位置（等待发车/催促上车/已出发/已到达，文字四色区分；底色区分未发车/运行中/已到达）。
- **虚拟站点（checkpoint）**：良乡⇄中关村 途经 京良收费站 → 杜家坎收费站 → 六里桥（无实际停靠），直接嵌入运行图中间轨道条（双向时间加权定位：京良 25.4% / 杜家坎 41.4% / 六里桥 62.3%）；「正在运行」列表与 PIDS 均展示位置信息。
- **QQ 内置浏览器提示**：检测到 QQ 内置浏览器（UA 判定 Android/iOS）时，5 秒后提示用系统浏览器打开以获得更好体验，可「知道了」或「复制链接」；QQ 提示优先于 iOS 安装引导（互斥）。
- **离线可看**：Service Worker（`sw.js`）预缓存全部静态资源；断网/弱网时先取缓存，导航失败回退 `/index.html`，时间 API 失败自动降级本机时钟。
- **购票倒计时**：
  - 免费班次（¥0.00）：价格 tag「免费」+ 开售状态「全天可约」，无需抢票。
  - 彩虹巴士：全周可约，无需抢票。
  - 一般班次：开售窗口 `T-1:00:00 ~ T-0:05:00`，「距开售 HH:MM:SS」倒计时；开售 5 分钟内「开售中 · 立即抢」，之后「可能已售罄」，`T-5min` 后「已停止售票」。
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
| `lib/duration-profiles.js` | 高德耗时预测原始数据（邻近插值） |
| `assets/qr-*.png` | 高德导航静态二维码（桌面扫码） |
| `tests/` | auto-test（`node --test tests/schedule.test.mjs`，22 项） |
| `docs/ARCHITECTURE.md` | 架构 / 设计原因 / 改动历史（面向 LLM） |
| `_headers` | Cloudflare Pages 安全头 / 缓存 |
| `meta.json` | 站点元数据（X-B4 约定） |

## 修改耗时

- 耗时表原始预测值保留在 `lib/duration-profiles.js`（含重叠点），按发车时间**邻近插值**。
- **超过 1 小时一律按 1 小时计**（`MAX_DURATION_MIN = 60`，理由：公交专用道，班车通常比轿车快）。灰色小字提示：预测时间仅考虑路况平均拥堵，无法保证突发事件影响，请以实际运行为准。

```js
export const DURATION_MIN = 60;            // 默认耗时（分钟）
export const DURATION_BY_ROUTE = {
  a: 60,                                    // 按线路覆盖：a=良乡→中关村
  c: 60                                     // c=中关村→良乡
};
// 或在某条班次上单独覆盖（仍受 1 小时封顶约束）：
{ id: "a3", route: "a", dep: "07:30", price: "¥10.00", rainbow: true, dur: 70 }
```

优先级：`trip.dur` > `DURATION_BY_ROUTE[route]` > 耗时表邻近插值 > `DURATION_MIN`，最终统一 `min(…, 60)`。

## 本地预览与测试

```powershell
# 本地预览（ES module 需 HTTP）
python -m http.server 8877 --bind 127.0.0.1   # 打开 http://127.0.0.1:8877/

# auto-test
node --test tests/schedule.test.mjs
```

## 发版注意

改代码后记得**同步 bump 版本号**（`index.html`、`app.js`、`schedule-data.js` 中的 `?v=20260902-N`），否则可能吃到 zone 层旧缓存。详见 `docs/ARCHITECTURE.md` §7。

## 部署

GitHub push 到 `main` 即触发 Cloudflare Pages 自动构建（Git 集成，无构建命令、根目录部署）。

## 许可

MIT License。
