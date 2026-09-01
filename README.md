# campus-shuttle-board

北京理工大学良乡 ⇄ 中关村 工作日校园班车时刻表 — 纯静态页面，浏览器本地实时推算，无后端。

线上：`https://bitbus.nslc.top`（GitHub `KJH-x/bit_shuttles` → Cloudflare Pages 自动构建）。

## 功能

- **正在运行（顶部）**：中关村-良乡双向**两行车道**（上=中关村→良乡、下=良乡→中关村，双色区分），同一时刻可有多班次同时在轨；班次为「胶囊 + 指北 bus emoji + 方向 tip」，**悬停显示**「往xx · 剩余x分钟」；默认不显示时间，可点「显示全部开行详情」强制展开（等效全部 hover）+ 展开各班次进度明细。
- **网络时间同步**：启动时通过 `time.akamai.com`（主）/ `timeapi.io`（备）获取标准时间，计算本机偏差并在整个页面使用；每 15 分钟重同步，状态徽标显示「网络时间已同步 / 使用本机时间」。
- **即将开行**：列出尚未发车的班次（已开行自动隐藏），倒计时实时刷新；筛选：全部 / 良乡→中关村 / 中关村→良乡 / **除彩虹巴士**。
- **购票倒计时**：
  - 免费班次（¥0.00）：全天可预约，无抢票。
  - 彩虹巴士：全周可预约，无需抢票。
  - 一般班次：开售窗口为发车前 `T-1:00:00 ~ T-0:05:00`，显示「距开售 HH:MM:SS」倒计时；开售后 5 分钟内通常售罄，之后显示红色「可能已售罄」。
- **动态刷新**：`setInterval` 每秒 tick，全部由浏览器本地计算，无需服务端。
- 主题：跟随系统 / 浅色 / 深色三态（localStorage 记忆，`data-theme` CSS 变量，风格与同工作区其他仓库一致）。

## 文件

| 文件 | 用途 |
| --- | --- |
| `index.html` | 页面结构 |
| `style.css` | 样式（CSS 变量主题、双车道进度条、购票徽标、全局按钮） |
| `schedule-data.js` | 时刻表数据 + 运行耗时配置（改这里） |
| `app.js` | 实时推算逻辑 |
| `lib/schedule.js` | 纯逻辑（班次状态、购票信息、格式化） |
| `lib/time.js` | 网络时间同步 |
| `tests/` | auto-test（`node --test`） |
| `_headers` | Cloudflare Pages 安全头 / 缓存 |
| `meta.json` | 站点元数据（X-B4 约定） |

## 修改耗时

- 耗时表原始预测值保留在 `lib/duration-profiles.js`（含重叠点），按发车时间**邻近插值**。
- **超过 1 小时一律按 1 小时计**（`MAX_DURATION_MIN = 60`，理由：公交专用道，班车通常比轿车快）。灰色小字提示：预测时间仅考虑路况平均拥堵，无法保证突发事件影响，请以实际运行为准。
- 页面下方提供「正向 / 反向」两个按钮，打开高德地图查看实时路线耗时。

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
node --test tests/
```

## 部署

GitHub push 到 `main` 即触发 Cloudflare Pages 自动构建（Git 集成，无构建命令、根目录部署）。

## 许可

MIT License。
