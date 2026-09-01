# campus-shuttle-board

北京理工大学良乡 ⇄ 中关村（含回龙观 → 良乡）工作日校园班车时刻表 — 纯静态页面，浏览器本地实时推算，无后端。

## 功能

- **正在运行（顶部）**：中关村-良乡双向**共享一条进度横条**，同一时刻可有多个班次同时在轨；按「预计耗时」换算实时位置与剩余时间。
- **即将开行**：列出尚未发车的班次（已开行的自动隐藏），支持按方向 / 仅彩虹班车筛选，倒计时实时刷新。
- **动态刷新**：`setInterval` 每秒 tick，全部由浏览器本地计算，无需服务端。
- 主题：跟随系统 / 浅色 / 深色三态（localStorage 记忆，`data-theme` CSS 变量，风格与同工作区其他仓库一致）。

## 文件

| 文件 | 用途 |
| --- | --- |
| `index.html` | 页面结构 |
| `style.css` | 样式（CSS 变量主题、进度条、全局按钮） |
| `schedule-data.js` | 时刻表数据 + 运行耗时配置（改这里） |
| `app.js` | 实时推算逻辑 |
| `_headers` | Cloudflare Pages 安全头 / 缓存 |
| `meta.json` | 站点元数据（X-B4 约定） |

## 修改耗时

当前全部按 1 小时估算。拿到实际预计耗时后改 `schedule-data.js`：

```js
export const DURATION_MIN = 60;            // 默认耗时（分钟）
export const DURATION_BY_ROUTE = {
  a: 60,                                    // 按线路覆盖：a=良乡→中关村
  c: 60                                     // c=中关村→良乡
};
// 或在某条班次上单独覆盖：
{ id: "a3", route: "a", dep: "07:30", price: "¥10.00", rainbow: true, dur: 70 }
```

优先级：`trip.dur` > `DURATION_BY_ROUTE[route]` > `DURATION_MIN`。

## 本地预览

```powershell
python -m http.server 8877 --bind 127.0.0.1   # 在仓库目录下运行
# 打开 http://127.0.0.1:8877/
```

> 需通过 HTTP 访问（ES module 加载）。

## 许可

MIT License。
