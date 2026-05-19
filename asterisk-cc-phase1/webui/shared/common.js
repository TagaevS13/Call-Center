// Shared utilities for Agent and Supervisor UIs.

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

export function fmtTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
export function fmtDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

export function toast(text, kind = "info", ms = 2800) {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = el("div", { id: "toast-host" });
    Object.assign(host.style, {
      position: "fixed", right: "16px", bottom: "16px",
      display: "flex", flexDirection: "column", gap: "8px", zIndex: 1000,
    });
    document.body.append(host);
  }
  const colors = { info: "var(--acc)", ok: "var(--ok)", warn: "var(--warn)", err: "var(--err)" };
  const t = el("div", { class: "card", html: text });
  t.style.borderLeft = `4px solid ${colors[kind] || colors.info}`;
  host.append(t);
  setTimeout(() => t.remove(), ms);
}

export function loadConfig() {
  const raw = localStorage.getItem("cc.config");
  return raw ? JSON.parse(raw) : null;
}
export function saveConfig(cfg) {
  localStorage.setItem("cc.config", JSON.stringify(cfg));
}

// Tiny pub/sub for UI events.
export function bus() {
  const map = new Map();
  return {
    on(ev, fn) { (map.get(ev) || map.set(ev, []).get(ev)).push(fn); return () => this.off(ev, fn); },
    off(ev, fn) { const a = map.get(ev) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    emit(ev, payload) { (map.get(ev) || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }); },
  };
}
