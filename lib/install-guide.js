const STYLE_ID = "shuttle-guide-style";

const GUIDE_CSS = `
.shuttle-guide-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, .45);
}
.shuttle-guide-card {
  width: 100%;
  max-width: 360px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 18px;
  box-shadow: var(--shadow);
  padding: 24px;
}
.shuttle-guide-title {
  margin: 0 0 10px;
  font-size: 1.2rem;
  font-weight: 800;
  color: var(--text);
}
.shuttle-guide-steps {
  margin: 0 0 14px;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: .92rem;
  color: var(--text);
}
.shuttle-guide-note {
  margin: 0 0 18px;
  font-size: .78rem;
  line-height: 1.5;
  color: var(--muted);
}
.shuttle-guide-note strong {
  display: inline-flex;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--tag-bg);
  color: var(--tag-text);
  font-weight: 700;
}
.shuttle-guide-btn {
  display: block;
  width: 100%;
  padding: 9px 18px;
  border: none;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-family: inherit;
  font-size: .9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s ease;
}
.shuttle-guide-btn:hover {
  background: var(--primary-hover);
}
.shuttle-guide-btn:focus-visible {
  outline: 2px solid var(--accent-light);
  outline-offset: 2px;
}
`;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = GUIDE_CSS;
  document.head.appendChild(style);
}

function buildDialog() {
  const overlay = document.createElement("div");
  overlay.className = "shuttle-guide-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "shuttle-guide-title");
  overlay.innerHTML = `
    <div class="shuttle-guide-card">
      <h2 class="shuttle-guide-title" id="shuttle-guide-title">添加到主屏幕 · 作为网页 App 使用</h2>
      <ol class="shuttle-guide-steps">
        <li>长按顶部地址栏</li>
        <li>点击「分享」按钮</li>
        <li>向下滑动选择「添加到主屏幕」，再点「添加」</li>
      </ol>
      <p class="shuttle-guide-note">添加后图标会出现在主屏幕，点开即可像 App 一样使用。系统默认勾选 <strong>「作为网页App打开」</strong>，无需额外设置。</p>
      <button type="button" class="shuttle-guide-btn">知道了</button>
    </div>
  `;
  const btn = overlay.querySelector(".shuttle-guide-btn");
  const previousFocus = document.activeElement;
  const close = () => {
    localStorage.setItem("shuttle-pwa-hint-dismissed", "1");
    overlay.remove();
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
    document.removeEventListener("keydown", onKeydown);
    if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
  };
  function onKeydown(e) {
    if (e.key === "Escape") close();
  }
  btn.addEventListener("click", close);
  document.addEventListener("keydown", onKeydown);
  document.body.appendChild(overlay);
  btn.focus();
}

export function initInstallGuide() {
  const ua = navigator.userAgent;
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|EdgiOS|FxiOS/i.test(ua);
  const isStandalone =
    navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  if (!isIOS || !isSafari || isStandalone) return false;
  if (localStorage.getItem("shuttle-pwa-hint-dismissed")) return false;
  window.addEventListener("load", () => {
    setTimeout(() => {
      injectStyle();
      buildDialog();
    }, 5000);
  });
  return true;
}
