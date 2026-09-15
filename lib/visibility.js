// 页面可见性轮询闸门：后台标签页暂停轮询，恢复可见时触发回调立即刷新。
// node 测试环境（无 document）下 isHidden() 恒为 false、回调照常注册。

const visibleCbs = new Set();
let bound = false;

function bind() {
  if (bound || typeof document === "undefined") return;
  bound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") {
      for (const cb of visibleCbs) {
        try { cb(); } catch {}
      }
    }
  });
}

export function isHidden() {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function onVisible(cb) {
  visibleCbs.add(cb);
  bind();
  return () => visibleCbs.delete(cb);
}
