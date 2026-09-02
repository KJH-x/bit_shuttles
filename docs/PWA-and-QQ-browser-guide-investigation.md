# 调查报告：Safari PWA 安装引导 + QQ 内置浏览器提示（可行性确认）

> 调查日期：2026-09-02。仅调研，未改动任何功能代码。
> 调查方式：`browser` 工具 + DuckDuckGo/Bing/CNBlogs/掘金/web.dev/WebKit 官方博客/腾讯云社区等网页取证。

两个需求：
1. 检测「客户端为 iOS Safari 且未处于 PWA（standalone）模式」，在页面完全加载 5 秒后弹出 PWA 安装引导：长按地址栏 → 分享 → 添加到主屏幕（默认勾选「作为网页App打开」）。
2. 检测「页面在 QQ 内置浏览器中打开」，5 秒后提示用户用系统浏览器打开以获得更好体验（可忽略/关闭）。

**结论：两条均可行。检测方案成熟可靠；无法实现的是「自动拉起系统浏览器」，只能引导用户。**

> **2026-09-02 补充（iOS 26 / 27 最新版）**：
> - iOS 26（稳定版）/ iPadOS 26 起，WebKit 改变了「添加到主屏幕」的行为：**任何**添加到主屏幕的网站**默认都作为网页 App 打开**（对话框中「Open as Web App / 作为网页App打开」默认开启），不再要求站点具备 `manifest`/`apple-mobile-web-app-capable`。若用户想存成普通书签，可在添加时手动关闭该开关（即使站点配置为 Web App 也生效）。
> - 因此需求 1 的引导文案「添加到主屏幕（默认勾选作为网页App打开）」与 iOS 26 的**系统默认行为完全一致**，对 iOS 26+ 用户提示含义依然正确；对本项目（已有 manifest）无额外要求，manifest 仍用于图标/名称/独立窗口等增强。
> - `beforeinstallprompt` 事件在 iOS 26/27 依旧**不提供**（WebKit bug 255716 仍为 open；Apple Developer Forums 2025-11 仍在请求该功能；caniuse 仅 Chromium 支持）。「自定义提示层引导手动安装」仍是 iOS 上唯一可行方案，结论不变。
> - iOS 27（Safari 27 beta）本轮 WebKit 更新**不含**安装类 API 变更，仅有对 PWA 的间接增强（Service Worker static routing API，优化高性能 PWA 请求路由）。对本文方案无影响。
> - 详情见文末「五、iOS 26/27 更新纪要」。

---

## 一、需求 1：iOS Safari 非 PWA 模式检测 + 安装引导

### 1.1 可行性结论：可行（iOS 26/27 依旧成立）

- iOS Safari **不支持** `beforeinstallprompt` 事件（web.dev、Stack Overflow、WebKit bug 255716、caniuse 均确认；iOS 26/27 仍如此）。因此 iOS 上**无法程序化弹出安装对话框**，唯一可行做法是：检测到非 standalone 模式后，用自定义提示层引导用户手动「添加到主屏幕」。这正是行业标准做法。
- iOS 26 起即使没有 manifest，添加到主屏幕也会默认作为网页 App 打开；这使「引导用户去添加主屏」的价值只增不减（用户不再需要理解什么是 PWA，加了就是 App）。
- PWA 模式（是否以独立 App 窗口运行）可以可靠检测，方案见下。

### 1.2 检测「当前是否已是 PWA 模式」——两种手段叠加

```js
const isStandalone = navigator.standalone === true
  || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
```

| 手段 | 平台 | 说明 |
| --- | --- | --- |
| `navigator.standalone` | iOS Safari 专属 | 从主屏幕 Web App 启动时为 `true`；在普通 Safari 标签中为 `false`；非 iOS 浏览器为 `undefined` |
| `window.matchMedia('(display-mode: standalone)')` | 跨平台 | Chrome/Android 也支持；iOS 13+ 支持 display-mode 查询 |

> web.dev（https://web.dev/learn/pwa/detection/）官方推荐用 `matchMedia('(display-mode: standalone)')`，并配合 `navigator.standalone` 覆盖 iOS。两个条件用 `||` 合并即可。

### 1.3 检测「是不是 iOS Safari」

```js
const ua = navigator.userAgent;
const isIPhoneOrIPad = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|EdgiOS|FxiOS/i.test(ua);
```

> 提示层仅在 `isIPhoneOrIPad && isSafari && !isStandalone` 时展示，避免打扰 Android/桌面/已安装 PWA 的用户。

### 1.4 iOS 安装流程（引导文案依据）

官方路径（Apple 支持文档、iOS 16.4 起网页可真正成为独立 App；iOS 26 进一步放行为「所有站点默认网页 App」）：
`Safari → 底部/顶部「分享」→ 向下滚动 → 「添加到主屏幕」→ 「添加」`。

- iOS 16.4+：对具备 `manifest` 的 PWA 站点，添加后以独立 App 窗口运行（可收推送、单开进程、单独设置）。添加对话框中「作为网页App打开」默认勾选，与用户描述一致。
- **iOS 26+：任何站点添加主屏都默认作为网页 App 打开**（默认勾选「作为网页App打开」），可手动改回书签。引导文案「添加到主屏幕（默认作为网页App打开）」在 iOS 26/27 上完全准确。
- 用户建议的「长按地址栏 → 分享 → 添加到主屏幕」也是被广泛使用的引导方式（长按地址栏同样弹出分享菜单）。两者皆可，按需选用。
- 本项目已具备 PWA 条件：`manifest.webmanifest`（standalone）、`apple-touch-icon.png`、`sw.js`、theme-color、`mobile-web-app-capable`。无需新增元数据即可被 iOS 识别为可安装 Web App（iOS 26 甚至不要求 manifest 也能网页 App 化）。

### 1.5 实现要点（写功能时的骨架）

```js
// 完全加载后延时 5s
window.addEventListener('load', () => {
  setTimeout(() => {
    if (!isIPhoneOrIPad || !isSafari || isStandalone) return;          // 非目标环境跳过
    if (localStorage.getItem('shuttle-pwa-hint-dismissed')) return;    // 已忽略不再打扰
    showInstallGuide();                                                 // 自定义模态：长按地址栏→分享→添加到主屏幕（默认勾选作为网页App打开）
  }, 5000);
});
// 关闭按钮/「知道了」→ localStorage.setItem('shuttle-pwa-hint-dismissed', '1')
```

- 提示层：半透明遮罩 + 卡片（步骤图/文字 + 「知道了」按钮），`aria` 对齐无障碍。
- 与需求 2 的 QQ 提示互斥：QQ 内置浏览器里无需引导 PWA（且 QQ 内也无法添加主屏 App）。

### 1.6 已知局限（如实说明）

- 若用户已安装 PWA、但从 Safari 普通标签打开站点，**无法**从页面侧得知「已安装」（SO 确认无此 API；iOS 26 也无变化）。只能靠 `localStorage` 记住「已引导/已忽略」来降噪，无法 100% 区分已装未装。
- `display-mode`/`navigator.standalone` 只能区分「本次运行形态」，无法探测设备上是否装着 App。

---

## 二、需求 2：QQ 内置浏览器检测 + 提示用系统浏览器

### 2.1 可行性结论：检测可行；「自动跳系统浏览器」不可行，只能引导

- **检测**：UA 特征在 Android/iOS 上均有稳定可区分的标识，社区有完整方案（博客园 Jason1995、掘金 7311166617878855690、CSDN 121958577 等互相印证）。
- **跳转**：嵌入式 WebView 无法用 JS 强制拉起系统默认浏览器（无标准 API；`window.open`/`location` 都只能留在 WebView 内）。行业做法 = 展示可关闭提示层，引导用户在 QQ 右上角「…」→「在浏览器中打开」，或复制链接到系统浏览器；或跳到腾讯官方的中转引导页（`https://c.pc.qq.com/middle.html?pfurl=...`）。

### 2.2 检测规则（已核实）

关键差异：**QQ 浏览器 App**（独立 App）与 **QQ 内置浏览器**（QQ 聊天里点链接打开的 WebView）UA 不同。

| 平台 | QQ 内置浏览器（目标） | QQ 浏览器 App（非目标） |
| --- | --- | --- |
| Android | 含 `MQQBrowser` **且** 随后带 ` QQ`（空格+QQ） | 含 `MQQBrowser` 但不含独立 `QQ` |
| iOS | 含 ` 空格+QQ` 但**不含** `MQQBrowser` | 含 `MQQBrowser` 但不含独立 `QQ` |

参考实现（掘金）：

```js
const isQQApp = (ua) => {
  const isIos = /iphone os/i.test(ua) || /ipad/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const _isIosQQ = isIos && /\sqq/i.test(ua);                                   // iOS: 空格+QQ，无 MQQBrowser
  const _isAndroidQQ = isAndroid && /mqqbrowser/i.test(ua)
    && /qq/i.test(ua.replaceAll('mqqbrowser', ''));                              // Android: MQQBrowser 且另有 QQ
  return _isIosQQ || _isAndroidQQ;
};
```

> 补充：微信内置浏览器 = `MicroMessenger`（若日后要加微信同理）；支付宝 = `AlipayClient`。

### 2.3 实现要点

```js
window.addEventListener('load', () => {
  setTimeout(() => {
    if (!isQQApp(navigator.userAgent)) return;                     // 非 QQ 内置浏览器
    if (sessionStorage.getItem('qq-browser-hint-dismissed')) return; // 本次会话已忽略
    showQQBrowserGuide();                                           // 可关闭提示：建议用系统浏览器打开以获得更好体验
  }, 5000);
});
```

- 提示层需可关闭（「知道了」/「×」），并写 `sessionStorage`（会话级）或 `localStorage`（长期）降噪，避免每次打扰。
- 文案建议：「当前在 QQ 内置浏览器中打开，建议点击右上角『···』→『在浏览器中打开』，或复制链接到系统浏览器，以获得更好体验。」可附带复制链接按钮。

---

## 三、两条功能可共存（互斥触发）

- 两个检测相互独立，弹层互斥：QQ 内置浏览器场景只弹「换浏览器」，iOS Safari 非 PWA 场景只弹「添加到主屏幕」。
- 两者都挂在 `window.load` 后 5 秒，先判断优先级，同一时刻最多一个提示层。

## 四、证据来源汇总

| 主题 | 来源 |
| --- | --- |
| display-mode 检测 | https://web.dev/learn/pwa/detection/ |
| iOS 无 beforeinstallprompt | https://stackoverflow.com/questions/55302527 · https://stackoverflow.com/questions/51160348 |
| WebKit bug：beforeinstallprompt 仍 open | https://bugs.webkit.org/show_bug.cgi?id=255716 · https://caniuse.com/?search=beforeinstallprompt |
| Apple Dev Forums：仍请求 beforeinstallprompt（2025-11） | https://developer.apple.com/forums/thread/807603 |
| PWA 已安装不可探测（SO） | https://stackoverflow.com/questions/66009755 |
| iOS 16.4 网页 App 安装流程 | https://www.mobbang.com/mb/294106.html · https://support.apple.com/zh-cn/guide/iphone/iphea86e5236/ios |
| iOS 26 默认网页 App（WebKit 官方） | https://webkit.org/blog/17333/webkit-features-in-safari-26-0/ · https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/ |
| iOS 26 网页 App 默认行为（媒体解读） | https://www.idownloadblog.com/2025/06/17/apple-ios-26-safari-web-apps-home-screen-bookmarks/ · https://mjtsai.com/blog/2025/10/03/web-apps-in-ios-26/ |
| Safari 27 beta WebKit 更新 | https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/ |
| QQ/QQ浏览器/QQ内置区分 UA | https://www.cnblogs.com/Jason1995/p/15694244.html · https://juejin.cn/post/7311166617878855690 · https://blog.csdn.net/qq_42753705/article/details/121958577 |
| 内置浏览器引导打开外部浏览器 | https://cloud.tencent.com/developer/article/2219958（微信/QQ 内置浏览器检测与跳转提示思路） |

---

## 五、iOS 26 / 27 更新纪要（2026-09-02 复核）

### 5.1 现状

- **iOS 26**：稳定版（stable release）。
- **iOS 27**：beta 8 / public beta 阶段（Safari 27 beta，2026-07-20 发布 27.0 beta）。

### 5.2 关键变化：iOS 26 起「添加到主屏幕 = 网页 App」成为默认

- WebKit 官方（Safari 26.0 博客 + WWDC25 公告）确认：iOS 26 / iPadOS 26 起，**任意网站**添加到主屏幕后，点击图标**默认以网页 App（standalone）方式打开**；用户可在添加时关闭「Open as Web App」改存为普通书签，**即使站点 manifest 声明为 web app 也可被覆盖**。
- 历史背景：此前（iOS 11.4~25）只有带 `manifest` display 值或 `apple-mobile-web-app-capable` 的站点才以 standalone 打开；macOS 早在 Sep 2023（macOS 14 Sonoma）就统一「添加到程序坞即网页 App」。iOS 26 将这一统一行为引入 iPhone/iPad。
- 对开发者的影响：**manifest 不再是"能否变成 App"的开关**，而是「增强项」（图标、名称、独立窗口、主题色、推送等仍由 manifest/Service Worker 提供）。WebKit 官方明言「零可安装性要求」。

### 5.3 对本文两个需求的净结论

| 项目 | 结论 |
| --- | --- |
| 检测方法（`navigator.standalone` / `display-mode`） | 不变，iOS 26/27 仍有效（web app 模式下均返回 standalone） |
| `beforeinstallprompt` | iOS 26/27 仍不支持，自定义引导层仍是唯一可行做法 |
| 引导文案「添加到主屏幕（默认作为网页App打开）」 | 与 iOS 26 系统默认行为**完全一致**，文案无需修改 |
| 是否必须依赖 manifest | 否；本项目已有 manifest，属增强而非门槛 |
| iOS 27（Safari 27 beta） | 无安装类 API 变更；仅 Service Worker static routing（性能优化），对方案无影响 |

### 5.4 需要注意的新细节

- iOS 26 添加主屏对话框有「Open as Web App / 作为网页App打开」开关，默认开启；若用户手动关闭，则仍作为书签在默认浏览器打开。引导提示中可顺带说明「如未自动以网页App打开，请检查该开关」。
- 因为「所有站点默认网页 App」，iOS 26+ 用户里「已经手动添加过主屏、但当前从 Safari 标签访问」的场景会更常见——1.6 节所述「无法探测已安装」的局限在 iOS 26 上不变，仍靠 `localStorage` 降噪。
- Safari 27 的 58 项新特性（WWDC26）不涉及安装/Web App 行为；无需为 iOS 27 预留逻辑。
