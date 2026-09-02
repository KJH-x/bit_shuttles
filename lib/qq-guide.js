const STORAGE_KEY = "qq-browser-hint-dismissed";
const OVERLAY_ID = "shuttle-qq-guide-overlay";
const TITLE_ID = "shuttle-qq-guide-title";
const COPY_FEEDBACK_MS = 2000;
const SHOW_DELAY_MS = 5000;

function isQQApp() {
  const ua = navigator.userAgent;
  const isIos = /iphone os/i.test(ua) || /ipad/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const _isIosQQ = isIos && /\sqq/i.test(ua);
  const _isAndroidQQ = isAndroid && /mqqbrowser/i.test(ua) && /qq/i.test(ua.replaceAll("mqqbrowser", ""));
  return _isIosQQ || _isAndroidQQ;
}

function injectStyle() {
  if (document.getElementById("shuttle-qq-style")) return;
  const style = document.createElement("style");
  style.id = "shuttle-qq-style";
  style.textContent = `
    .shuttle-qq-overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(0, 0, 0, .45);
    }
    .shuttle-qq-card {
      width: min(100%, 360px);
      padding: 24px 22px;
      border-radius: 16px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      box-shadow: var(--shadow);
    }
    .shuttle-qq-card h2 {
      margin: 0 0 12px;
      font-size: 17px;
      line-height: 1.4;
      color: var(--text);
    }
    .shuttle-qq-card p {
      margin: 0 0 20px;
      font-size: 14px;
      line-height: 1.7;
      color: var(--muted);
    }
    .shuttle-qq-card__actions {
      display: flex;
      gap: 10px;
    }
    .shuttle-qq-card__btn {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 14px;
      cursor: pointer;
      color: var(--tag-text);
      background: var(--tag-bg);
    }
    .shuttle-qq-card__btn:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }
    .shuttle-qq-card__btn--primary {
      border-color: transparent;
      color: #fff;
      background: var(--primary);
    }
    .shuttle-qq-card__btn--primary:focus-visible {
      outline-color: var(--primary-hover);
    }
    .shuttle-qq-card__btn--ghost {
      background: transparent;
      color: var(--text);
    }
    .shuttle-qq-card__btn--copied {
      color: var(--success);
      border-color: var(--success);
    }
  `;
  document.head.appendChild(style);
}

function buildCard() {
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "shuttle-qq-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", TITLE_ID);

  const card = document.createElement("div");
  card.className = "shuttle-qq-card";
  card.tabIndex = -1;

  const title = document.createElement("h2");
  title.id = TITLE_ID;
  title.textContent = "建议在系统浏览器中打开";

  const text = document.createElement("p");
  text.textContent = "当前在 QQ 内置浏览器中打开，建议点击右上角『···』→『在浏览器中打开』，或复制链接到系统浏览器，以获得更好体验。";

  const actions = document.createElement("div");
  actions.className = "shuttle-qq-card__actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "shuttle-qq-card__btn shuttle-qq-card__btn--ghost";
  copyBtn.textContent = "复制链接";

  const okBtn = document.createElement("button");
  okBtn.type = "button";
  okBtn.className = "shuttle-qq-card__btn shuttle-qq-card__btn--primary";
  okBtn.textContent = "知道了";

  actions.append(copyBtn, okBtn);
  card.append(title, text, actions);
  overlay.appendChild(card);
  return { overlay, card, copyBtn, okBtn };
}

function closeGuide(overlay) {
  if (!overlay) return;
  overlay.remove();
  window.removeEventListener("keydown", onKeydown, true);
}

function onKeydown(e) {
  if (e.key !== "Escape") return;
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) closeGuide(overlay);
}

function bindCopy(btn, overlay) {
  btn.addEventListener("click", () => {
    navigator.clipboard
      .writeText(location.href)
      .then(() => {
        const original = btn.textContent;
        btn.textContent = "已复制";
        btn.classList.add("shuttle-qq-card__btn--copied");
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove("shuttle-qq-card__btn--copied");
        }, COPY_FEEDBACK_MS);
      })
      .catch(() => {});
  });
}

function bindDismiss(btn, overlay) {
  btn.addEventListener("click", () => {
    try {
      sessionStorage.setItem(STORAGE_KEY, "1");
    } catch (err) {}
    closeGuide(overlay);
  });
}

function showGuide() {
  injectStyle();
  const { overlay, card, copyBtn, okBtn } = buildCard();
  document.body.appendChild(overlay);
  bindCopy(copyBtn, overlay);
  bindDismiss(okBtn, overlay);
  window.addEventListener("keydown", onKeydown, true);
  card.focus();
}

export function initQQBrowserGuide() {
  if (!isQQApp()) return false;
  let dismissed = false;
  try {
    dismissed = !!sessionStorage.getItem(STORAGE_KEY);
  } catch (err) {}
  if (dismissed) return false;
  window.addEventListener("load", () => {
    setTimeout(showGuide, SHOW_DELAY_MS);
  });
  return true;
}
