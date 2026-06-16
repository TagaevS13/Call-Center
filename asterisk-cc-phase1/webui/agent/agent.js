import { $, $$, fmtDuration, fmtTime, toast, loadConfig, saveConfig } from "../shared/common.js";
import { apiGet } from "../shared/api.js";
import {
  requireSession,
  clearSession,
  hasPermission,
  resolveSkillIdsFromQueues,
  loadSkillQueues,
} from "../shared/auth.js";

const ccSession = requireSession({ roles: ["agent", "admin"], redirect: "../index.html" });
if (!ccSession) throw new Error("no session");

function defaultTelephonyHost() {
  const h = (window.location.hostname || "").trim();
  if (h && h !== "localhost" && h !== "127.0.0.1") return h;
  return "172.16.6.183";
}
function defaultWssUrl() {
  const host = defaultTelephonyHost();
  // UI по HTTP — без TLS; для доверенной LAN можно ws:// (без сертификата)
  if (window.location.protocol === "http:") {
    return `ws://${host}:8088/ws`;
  }
  return `wss://${host}:8089/ws`;
}

const LEGACY_TELEPHONY_HOSTS = new Set(["cc.example.local", "localhost", "127.0.0.1"]);

/** Старый localStorage (cc.example.local) ломает WSS — сертификат привязан к IP хоста. */
function normalizeTelephonyHost(host, tel = {}) {
  const h = (host || "").trim().toLowerCase();
  const api = (tel.domain || "").trim();
  const page = defaultTelephonyHost();
  if (!h || LEGACY_TELEPHONY_HOSTS.has(h) || h.includes("example.")) {
    return api || page;
  }
  const pageHost = (window.location.hostname || "").trim();
  if (pageHost && !LEGACY_TELEPHONY_HOSTS.has(pageHost) && h !== pageHost) {
    return api || pageHost || h;
  }
  return host.trim();
}

function resolveTelephonySettings(saved = {}, tel = {}) {
  const domain = normalizeTelephonyHost(saved.domain || tel.domain, tel);
  const useHttpWs = window.location.protocol === "http:";
  const sipWsOk = (url) =>
    (url.startsWith("wss://") || url.startsWith("ws://")) && url.includes("/ws");
  let wss = (saved.wss || (useHttpWs ? tel.ws : tel.wss) || tel.wss || tel.ws || defaultWssUrl()).trim();
  if (/example\.local|cc\.example/i.test(wss) || !sipWsOk(wss)) {
    wss = useHttpWs ? `ws://${domain}:8088/ws` : `wss://${domain}:8089/ws`;
  } else {
    try {
      const u = new URL(wss);
      const bad =
        LEGACY_TELEPHONY_HOSTS.has(u.hostname.toLowerCase()) || u.hostname.includes("example.");
      if (bad || u.hostname !== domain) {
        u.hostname = domain;
        u.port = useHttpWs && wss.startsWith("ws://") ? "8088" : "8089";
        u.protocol = useHttpWs && wss.startsWith("ws://") ? "ws:" : "wss:";
        u.pathname = "/ws";
        wss = u.toString();
      }
    } catch {
      wss = useHttpWs ? `ws://${domain}:8088/ws` : `wss://${domain}:8089/ws`;
    }
  }
  if (useHttpWs && tel.ws) wss = tel.ws;
  else if (!useHttpWs && tel.wss) wss = tel.wss;
  if (!useHttpWs && wss.startsWith("ws://")) {
    try {
      const u = new URL(wss);
      u.protocol = "wss:";
      if (!u.port || u.port === "8088") u.port = "8089";
      wss = u.toString();
    } catch {
      wss = `wss://${domain}:8089/ws`;
    }
  }
  const host = domain;
  return {
    domain,
    wss,
    cert_url: tel.cert_url || `https://${host}:8089/static/index.html`,
    agent_cert_url: tel.agent_cert_url || `https://${host}:9443/agent/`,
    cert_urls: tel.cert_urls || [
      `https://${host}:9443/agent/`,
      `https://${host}:8089/static/index.html`,
    ],
    turn: tel.turn !== false,
    turn_urls: tel.turn_urls,
    turn_user: tel.turn_user,
    turn_password: tel.turn_password,
    webrtc_mode: tel.webrtc_mode,
    bundle_policy: tel.bundle_policy,
  };
}

/** Edge/Chrome: принять самоподписанный TLS на :9443 (UI) и :8089 (WSS). */
async function ensureTlsExceptions(host, urls) {
  const list = urls?.length ? urls : [
    `https://${host}:9443/agent/`,
    `https://${host}:8089/static/index.html`,
  ];
  for (const url of list) {
    try {
      await fetch(url, { mode: "no-cors", cache: "no-store" });
    } catch { /* пользователь должен открыть ссылку вручную */ }
  }
}

let sipConnectAttempt = 0;
let sipReconnectTimer = null;
/** @type {import('sip.js').SessionState | null} */
let SipSessionState = null;

const state = {
  config: null,
  ua: null,
  registerer: null,
  sipCall: null,
  agentState: "OFFLINE",
  stateSince: Date.now(),
  call: null,             // active call: { dir, phase, number, name, queue, profile, startedAt, sn, mdn, group, calling, called }
  history: [],
  breaks: [],
  currentBreak: null,
  catalog: null,           // services_catalog.json content
  selectedSkills: new Set(),
  serviceRequests: [],     // current customer service requests for active call
  relatedTT: [],
  callRedirects: [],
  productList: [],
};

// ---- Section routing ----
function showSection(name) {
  $$(".view").forEach(v => v.toggleAttribute("hidden", v.dataset.view !== name));
  $$(".nav-item[data-section]").forEach(n => n.classList.toggle("active", n.dataset.section === name));
  if (name === "history") renderFullHistory();
  if (name === "kb") renderKb();
  if (name === "breaks") renderBreaks();
  if (name === "catalog") renderCatalogAdmin();
  location.hash = name;
}
$$(".nav-item[data-section]").forEach(n => n.addEventListener("click", () => showSection(n.dataset.section)));
window.addEventListener("hashchange", () => {
  const h = location.hash.replace("#", "") || "workspace";
  showSection(h);
});

// ---- SIP / session bootstrap ----
async function loadTelephonyDefaults() {
  try {
    const r = await fetch("/api/public/telephony");
    if (r.ok) return await r.json();
  } catch { /* ignore */ }
  return { domain: defaultTelephonyHost(), wss: defaultWssUrl() };
}

async function showSipModal() {
  const saved = loadConfig() || {};
  const tel = await loadTelephonyDefaults();
  const resolved = resolveTelephonySettings(saved, tel);
  saveConfig({ ...saved, user: ccSession.sipUser || saved.user || "1001", ...resolved });
  const sip = ccSession.sipUser || saved.user || "1001";
  $("#sip-who").textContent = `${ccSession.fullName} · ${ccSession.login} (${ccSession.roleLabel})`;
  $("#cfg-user").value = sip;
  const host = resolved.domain;
  $("#cfg-wss").value = resolved.wss;
  $("#cfg-domain").value = resolved.domain;
  const cert8089 = resolved.cert_url || `https://${host}:8089/static/index.html`;
  const cert9443 = resolved.agent_cert_url || `https://${host}:9443/agent/`;
  const certHint = $("#sip-cert-hint");
  if (certHint) {
    const edgeNote = /Edg\//.test(navigator.userAgent)
      ? " <strong>Edge:</strong> примите сертификат на <em>обеих</em> ссылках (9443 и 8089)."
      : "";
    certHint.innerHTML =
      `Перед «Продолжить» откройте и примите сертификат (Дополнительно → перейти на сайт):<br>` +
      `1) <a href="${cert9443}" target="_blank" rel="noopener">Agent UI :9443</a> — иначе «Небезопасно» и нет микрофона<br>` +
      `2) <a href="${cert8089}" target="_blank" rel="noopener">Asterisk WSS :8089</a> — иначе SIP не подключится` +
      edgeNote;
  }
  const certLink = document.getElementById("sip-cert-link");
  if (certLink) {
    certLink.href = cert8089;
    certLink.textContent = `${host}:8089 (WSS)`;
  }
  $("#sip-modal").classList.add("show");
}
function hideSipModal() {
  $("#sip-modal").classList.remove("show");
  $("#app").style.display = "grid";
}

function buildConfig(tel = {}) {
  const saved = loadConfig() || {};
  const fromUi = {
    wss: ($("#cfg-wss")?.value || "").trim(),
    domain: ($("#cfg-domain")?.value || "").trim(),
  };
  const resolved = resolveTelephonySettings({ ...saved, ...fromUi }, tel);
  return {
    user: ccSession.sipUser || saved.user || "1001",
    pass: ccSession.sipPassword || "",
    wss: resolved.wss,
    domain: resolved.domain,
    cert_url: resolved.cert_url,
    agent_cert_url: resolved.agent_cert_url,
    cert_urls: resolved.cert_urls,
    login: ccSession.login,
  };
}

/** Освободить микрофон после звонка (Edge/Chrome не «глушит» другие вкладки). */
function releaseAgentMicrophone() {
  const pc = state.sipCall?.sessionDescriptionHandler?.peerConnection;
  pc?.getSenders().forEach((s) => {
    if (s.track) {
      try { s.track.stop(); } catch (_) { /* ignore */ }
    }
  });
}

function agentHttpsUrl() {
  const host = defaultTelephonyHost();
  const tlsPort = "9443";
  return `https://${host}:${tlsPort}/agent/`;
}

function warnInsecureMicrophone() {
  if (window.isSecureContext) return false;
  const url = agentHttpsUrl();
  toast(
    `Микрофон в браузере недоступен по HTTP. Откройте Agent по HTTPS: ${url} (примите сертификат один раз).`,
    "err",
    20000
  );
  return true;
}

async function ensureMicrophoneAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Браузер не поддерживает доступ к микрофону");
  }
  const stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
  stream.getTracks().forEach((t) => t.stop());
}

async function continueWorkspaceSetup() {
  const tel = await loadTelephonyDefaults();
  state.config = buildConfig(tel);
  saveConfig(state.config);
  await ensureTlsExceptions(state.config.domain, state.config.cert_urls);
  hideSipModal();
  $("#who").textContent = `${ccSession.fullName} · ${ccSession.login}`;
  if (ccSession.role === "admin") {
    $("#btn-admin").hidden = false;
    $("#btn-admin").addEventListener("click", () => { location.href = "../admin/"; });
  }
  await loadCatalog();
  await enterShift();
}

async function beginWorkspace() {
  if (warnInsecureMicrophone()) {
    const go = confirm(
      `Для ответа на звонки нужен HTTPS.\n\nОткрыть ${agentHttpsUrl()} ?`
    );
    if (go) window.location.href = agentHttpsUrl();
    return;
  }
  try {
    await ensureMicrophoneAccess();
  } catch (e) {
    toast(`Разрешите доступ к микрофону в браузере: ${e?.message || e}`, "err", 12000);
    return;
  }
  unlockAudioPlayback();
  await requestCallNotifications();
  await continueWorkspaceSetup();
}

function getAssignedSkillIds() {
  if (ccSession.assignedSkillIds?.length) return ccSession.assignedSkillIds;
  return resolveSkillIdsFromQueues(ccSession.queueBindings, state.catalog);
}

function applySkillIds(ids) {
  state.selectedSkills = new Set(ids);
  const cfg = loadConfig() || {};
  cfg.skills = ids;
  saveConfig(cfg);
}

function setupSkillsButton() {
  const btn = $("#btn-skills");
  if (!btn) return;
  if (ccSession.pickSkills) {
    btn.hidden = false;
    btn.onclick = () => showSkillsModal();
  }
}

async function enterShift() {
  setupSkillsButton();
  if (!ccSession.pickSkills) {
    const ids = getAssignedSkillIds();
    applySkillIds(ids);
    const names = (state.catalog?.skill_queues || [])
      .filter(s => ids.includes(s.id)).map(s => s.name).join(", ");
    toast(`Очереди назначены администратором: ${names || ids.join(", ")}`, "ok");
    finishShiftStart();
    return;
  }
  showSkillsModal();
}

let shiftStarted = false;
function finishShiftStart() {
  if (shiftStarted) return;
  shiftStarted = true;
  startSip();
  loadCallHistory();
  showSection(location.hash.replace("#", "") || "workspace");
}

async function loadCallHistory() {
  const sip = state.config?.user || ccSession.sipUser;
  if (!sip) return;
  try {
    const res = await apiGet(`/ops/cdr?agent=${encodeURIComponent(sip)}`);
    state.history = (res.history || []).map(h => ({
      time: h.time || "",
      date: h.date ? new Date(h.date) : new Date(),
      queue: h.queue || "—",
      number: h.number || "",
      dur: h.dur || 0,
      outcome: h.outcome || "unknown",
      wrap: h.wrap || "",
      rec: !!h.rec,
    }));
    renderFullHistory();
  } catch {
    state.history = [];
  }
}

$("#btn-sip-ok").addEventListener("click", beginWorkspace);
$("#btn-sip-cancel").addEventListener("click", () => { location.href = "../index.html"; });

$("#btn-logout").addEventListener("click", () => {
  clearSession();
  location.href = "../index.html";
});

if (!ccSession.sipUser && ccSession.role === "agent") {
  toast("У оператора не задан SIP extension — укажите в админке", "warn");
}

// ---- Skills modal ----
function showSkillsModal() {
  const tbody = $("#skills-tbl tbody"); tbody.innerHTML = "";
  const saved = loadConfig()?.skills || [];
  const skills = state.catalog?.skill_queues || [];
  const allowedQueues = new Set(
    (ccSession.queueBindings || []).map(b => b.queue)
  );
  for (const s of skills) {
    const tr = document.createElement("tr");
    const queueName = (s.queue || s.name || "").toLowerCase();
    const inGroup = !allowedQueues.size || allowedQueues.has(queueName) || allowedQueues.has(s.name);
    const checked = inGroup && (saved.includes(s.id) || (saved.length === 0 && inGroup));
    tr.innerHTML = `
      <td><input type="checkbox" data-id="${s.id}" ${checked ? "checked" : ""} /></td>
      <td>${s.id}</td>
      <td>${s.name}</td>`;
    tbody.appendChild(tr);
    if (checked) state.selectedSkills.add(s.id);
  }
  $$("#skills-tbl input[type=checkbox]").forEach(cb => cb.addEventListener("change", e => {
    const id = parseInt(e.target.dataset.id, 10);
    if (e.target.checked) state.selectedSkills.add(id);
    else state.selectedSkills.delete(id);
  }));
  $("#skills-modal").classList.add("show");
}
$("#skills-all").addEventListener("change", e => {
  $$("#skills-tbl input[type=checkbox]").forEach(cb => {
    cb.checked = e.target.checked;
    cb.dispatchEvent(new Event("change"));
  });
});
$("#skills-search").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  $$("#skills-tbl tbody tr").forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });
});
function hideSkillsModal() {
  $("#skills-modal").classList.remove("show");
}
function closeSkillsModal({ startShift = false } = {}) {
  hideSkillsModal();
  if (startShift) finishShiftStart();
}
$("#skills-cancel").addEventListener("click", () => {
  closeSkillsModal({ startShift: true });
  toast("Окно очередей закрыто. Позже: кнопка «Очереди» в шапке.", "info");
});
$("#skills-close").addEventListener("click", () => closeSkillsModal({ startShift: true }));
$("#skills-modal").addEventListener("click", e => {
  if (e.target.id === "skills-modal") closeSkillsModal({ startShift: true });
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("#skills-modal").classList.contains("show")) {
    closeSkillsModal({ startShift: true });
  }
});
$("#skills-ok").addEventListener("click", () => {
  if (!state.selectedSkills.size) {
    toast("Выберите хотя бы одну очередь или нажмите «Отмена»", "warn");
    return;
  }
  applySkillIds([...state.selectedSkills]);
  hideSkillsModal();
  toast(`Выбраны skill queues: ${[...state.selectedSkills].join(", ")}`, "ok");
  finishShiftStart();
});

// ---- Top bar buttons ----
$("#btn-ready").addEventListener("click", () => setAgentState("READY"));
$("#btn-pause").addEventListener("click", () => setAgentState("PAUSE"));
$("#btn-aftercall").addEventListener("click", () => setAgentState("AFTERCALL"));
$("#btn-theme").addEventListener("click", () => {
  const t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
});
$("#global-search").addEventListener("keydown", e => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim();
  if (!q) return;
  toast(`Поиск: «${q}» (REST /api/search/{q})`, "info");
});

// ---- CSP toolbar ----
document.getElementById("btn-unlock-audio")?.addEventListener("click", () => {
  unlockAudioPlayback();
  void syncRemoteAudioFromSession(state.sipCall, { notify: true });
});
$$('[data-act="answer"]').forEach((b) => {
  b.addEventListener("pointerdown", unlockAudioPlayback, { capture: true });
});
$$(".csp-toolbar .ctrl").forEach(b => b.addEventListener("click", () => {
  const act = b.dataset.act;
  switch (act) {
    case "answer":   onAnswer(); break;
    case "release":  onHangup(); break;
    case "mute":     onMute(); break;
    case "hold":     onHold(); break;
    case "xfer":     onTransfer(); break;
    case "conf":     onConference(); break;
    case "dtmf": {
      const d = prompt("DTMF"); if (d) sendDtmf(d);
      break;
    }
    case "callout": {
      const n = prompt("Call out: номер?"); if (n) startOutbound(n);
      break;
    }
    case "busy":     setAgentState("BUSY"); break;
    case "leave":    setAgentState("OFFLINE"); break;
    case "integr":   toast("Integration (CRM popup) — open external CRM tab", "info"); break;
    case "rbt":      toast("Ring-back tone toggled", "info"); break;
    case "handle":   openServiceModal(); break;
    case "customer": $("#cf-handled").focus(); break;
    case "query":    onQuery(); break;
    case "sendsms":  onSendSms(); break;
  }
}));

// ---- Customer card buttons ----
$("#cf-query").addEventListener("click", onQuery);
async function onQuery() {
  const num = $("#cf-handled").value.trim();
  if (!num) { toast("Введите Handled number", "warn"); return; }
  try {
    const res = await apiGet(`/subscribers/${encodeURIComponent(num)}`);
    const p = res.profile || {};
    if (res.error) toast(`CRM: ${res.error}`, "warn", 4000);
    fillCustomer(p);
    toast(`Карточка: ${p.name || p.msisdn || num}`, "ok");
  } catch (e) {
    toast(e.message || "Ошибка запроса CRM", "err");
  }
}
function onSendSms() {
  const num = $("#cf-handled").value.trim();
  if (!num) { toast("Введите Handled number", "warn"); return; }
  const text = prompt(`SMS на ${num}:`, "");
  if (text) toast(`SMS «${text}» поставлено в очередь Kannel (демо)`, "ok");
}

// ---- Dial ----
$("#btn-dial").addEventListener("click", () => {
  const n = $("#dial-num").value.trim();
  if (!n) return;
  startOutbound(n);
});

// ---- Wrap-up ----
$("#btn-save-wrap").addEventListener("click", () => {
  const outcome = $("#wrap-outcome").value;
  const note = $("#wrap-note").value.trim();
  if (!outcome) { toast("Заполните результат wrap-up", "warn"); return; }
  const wrapText = note ? `${outcome}: ${note}` : outcome;
  const handled = $("#cf-handled").value.trim();
  const openSr = state.serviceRequests.find(r =>
    r.handled === handled && ["draft", "prehandle", "open"].includes(r.status)
  );
  if (openSr && !openSr.content && note) {
    openSr.content = note;
    openSr.progress = "Wrap-up";
    renderSRTabs();
  }
  if (state.history.length) state.history[0].wrap = wrapText;
  toast(`Wrap-up сохранён: ${outcome}`, "ok");
  $("#wrap-outcome").value = "";
  $("#wrap-note").value = "";
  $("#wrap-timer").textContent = "—";
  setAgentState("READY");
});

// ---- Refresh sidebar / SR / call info ----
$("#ci-refresh").addEventListener("click", () => { renderCallInfo(); toast("Refreshed", "info", 800); });
$("#btn-refresh-sr").addEventListener("click", () => renderSRTabs());

// ---- Tabs in customer lower panel ----
$$("#sr-tabs .tab").forEach(t => t.addEventListener("click", () => {
  $$("#sr-tabs .tab").forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  const name = t.dataset.tab;
  $$(".tab-pane").forEach(p => p.toggleAttribute("hidden", p.dataset.pane !== name));
}));

// ---- State machine ----
const AGENT_STATE_LABEL = {
  READY: "Ready",
  BUSY: "On call",
  PAUSE: "Pause",
  AFTERCALL: "Wrap-up",
  OFFLINE: "Offline",
};

function setAgentState(s) {
  state.agentState = s;
  state.stateSince = Date.now();
  const pill = $("#state-pill");
  pill.dataset.state = s;
  $("#state-text").textContent = AGENT_STATE_LABEL[s] || s;
  if (s !== "BUSY") toast(`Статус: ${AGENT_STATE_LABEL[s] || s}`, "info", 1200);
}

setInterval(() => {
  const sec = Math.floor((Date.now() - state.stateSince) / 1000);
  $("#state-time").textContent = fmtDuration(sec);
  if (state.call && state.call.startedAt) {
    $("#ci-dur").textContent = fmtDuration((Date.now() - state.call.startedAt)/1000);
  }
  if (state.agentState === "AFTERCALL") {
    $("#ci-arr").textContent = fmtDuration(sec);
  }
  if (state.currentBreak) {
    $("#break-timer").textContent = fmtDuration((Date.now() - state.currentBreak.start)/1000);
  }
}, 1000);

// ---- Call UI render ----
function renderCallInfo() {
  const c = state.call;
  const title = $("#ci-status");
  title.classList.remove("busy", "talking", "ringing", "arrange");
  if (!c) {
    title.textContent = state.agentState === "AFTERCALL" ? "Arranging" : "No call";
    if (state.agentState === "AFTERCALL") title.classList.add("arrange");
    $("#ci-sn").textContent = "—";
    $("#ci-dur").textContent = "00:00:00";
    $("#ci-calling").textContent = "—";
    $("#ci-called").textContent = "—";
    $("#ci-arr").textContent = "00:00:00";
    $("#ci-wait").textContent = "0";
    $("#ci-mdn").textContent = "—";
    $("#ci-group").textContent = "—";
    $("#ci-track").textContent = "—";
    return;
  }
  title.textContent = c.phase === "ringing" ? "Ringing" : "Talking";
  title.classList.add(c.phase === "ringing" ? "ringing" : "talking");
  $("#ci-sn").textContent      = c.sn;
  $("#ci-calling").textContent = c.calling || c.number;
  $("#ci-called").textContent  = c.called  || "—";
  $("#ci-mdn").textContent     = c.profile?.msisdn || c.number;
  $("#ci-group").textContent   = c.group || "—";
  $("#ci-wait").textContent    = c.waited ?? 0;
  $("#ci-track").textContent   = c.callid || c.sn;
}

function fillCustomer(p) {
  $("#cf-handled").value = p.msisdn || "";
  $("#cf-name").value    = p.name   || "";
  $("#cf-rate").value    = p.tariff || "";
  $("#cf-imsi").value    = p.imsi   || "";
  $("#cf-pin1").value    = p.pin1   || "";
  $("#cf-puk1").value    = p.puk1   || "";
  $("#cf-pin2").value    = p.pin2   || "";
  $("#cf-puk2").value    = p.puk2   || "";
  $("#cf-core").value    = p.core_balance || p.balance || "";
  $("#cf-balance").value = p.balance || "";
  $("#cf-cat").value     = p.category || "";
  $("#cf-code").value    = p.customer_code || "";
  $("#cf-acct").value    = p.account_code  || "";
  $("#cf-icc").value     = p.icc || "";
  // populate lower tabs from CRM profile
  state.serviceRequests = p.requests || [];
  state.relatedTT       = p.tickets  || [];
  state.callRedirects   = p.redirects|| [];
  state.productList     = p.products || [];
  renderSRTabs();
  $("#svc-handle").textContent = p.msisdn || "—";
}

function clearCustomer() {
  for (const id of ["cf-handled","cf-name","cf-rate","cf-imsi","cf-pin1","cf-puk1","cf-pin2","cf-puk2","cf-core","cf-balance","cf-cat","cf-code","cf-acct","cf-icc"]) {
    $("#" + id).value = "";
  }
  state.serviceRequests = []; state.relatedTT = []; state.callRedirects = []; state.productList = [];
  renderSRTabs();
}

function renderSRTabs() {
  const statusCls = (s) => (["submitted", "closed"].includes(s) ? "ok" : "warn");
  const fmtRow = (sr) => `<tr>
    <td>${sr.sn}</td>
    <td title="${(sr.content || "").replace(/"/g, "&quot;")}">${sr.type}</td>
    <td><span class="kbd">${sr.code}</span></td>
    <td>${new Date(sr.time).toLocaleString()}</td>
    <td>${sr.queue || sr.callGroup || "—"}</td>
    <td>${sr.staff}</td>
    <td><span class="tag ${statusCls(sr.status)}">${sr.progress || sr.status}</span></td>
    <td><button class="btn ghost" data-srx="${sr.sn}">Details</button></td>
  </tr>`;
  $("#sr-tbl tbody").innerHTML = state.serviceRequests.map(fmtRow).join("");
  $("#sr-tbl tbody").querySelectorAll("button[data-srx]").forEach(btn => {
    btn.addEventListener("click", () => {
      const sr = state.serviceRequests.find(r => r.sn === btn.dataset.srx);
      if (!sr) return;
      $("#cf-handled").value = sr.handled || "";
      $("#svc-handle").textContent = sr.handled || "—";
      const found = findCatalogItemByCode(sr.code);
      if (found) {
        openHandleDetail(found.cat, found.item, found.index, { editingSn: sr.sn });
      } else {
        toast("Каталог: пункт не найден, откройте Handle…", "warn");
      }
    });
  });

  $("#tt-tbl tbody").innerHTML = state.relatedTT.map(t => `
    <tr><td>${t.no}</td><td>${t.cat}</td><td>${t.created}</td><td>${t.assigned}</td>
    <td><span class="tag ${t.status==='closed'?'ok':'warn'}">${t.status}</span></td></tr>`).join("");

  $("#cr-tbl tbody").innerHTML = state.callRedirects.map(r => `
    <tr><td>${r.from}</td><td>${r.to}</td><td>${r.type}</td><td>${r.active?"Да":"Нет"}</td></tr>`).join("");

  $("#pl-tbl tbody").innerHTML = state.productList.map(p => `
    <tr><td>${p.name}</td><td><span class="tag ${p.active?'ok':''}">${p.active?'active':'inactive'}</span></td>
    <td>${p.since}</td><td>${p.fee}</td></tr>`).join("");
}

function pushHistory(row) {
  row.date = new Date();
  state.history.unshift(row);
  if (state.history.length > 500) state.history.pop();
}

// ---- WebRTC audio (remote = абонент, local = микрофон) ----
let remoteAudioEl = null;
/** Один MediaStream на весь звонок — srcObject не пересоздаём (иначе AbortError в Chrome). */
let remotePlaybackStream = null;
let remoteSyncTimer = null;
let webrtcStatsTimer = null;
let inboundRtpWarnShown = false;

/**
 * ICE: host + TURN (не только relay — иначе one-way на том же IP PBX).
 * cc_agent_config: ice_turn:false / ice_stun:true
 */
function buildPeerConnectionConfiguration(tel = {}) {
  const cfg = loadConfig() || {};
  const host = state.config?.domain || defaultTelephonyHost();
  const iceServers = [];
  const useTurn = cfg.ice_turn !== false && cfg.ice_turn !== "0" && tel.turn !== false;
  if (useTurn) {
    iceServers.push({
      urls: tel.turn_urls || [`turn:${host}:3478?transport=udp`],
      username: tel.turn_user || "ccagent",
      credential: tel.turn_password || "ccagentturn",
    });
  }
  if (cfg.ice_stun === true || cfg.ice_stun === "1") {
    iceServers.push({ urls: "stun:stun.l.google.com:19302" });
  }
  // bundlePolicy согласуется с AGENT_WEBRTC_MODE на сервере:
  //  manual (bundle=no)  -> "balanced"   (max-bundle ломает Answer: нет a=group:BUNDLE)
  //  standard (webrtc=yes -> bundle=yes) -> "max-bundle"
  const bundlePolicy = tel.bundle_policy === "max-bundle" ? "max-bundle" : "balanced";
  return {
    iceServers,
    iceTransportPolicy: "all",
    bundlePolicy,
    rtcpMuxPolicy: "require",
  };
}

const audioConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
  },
  video: false,
};

/** Лог [CC-RTP] в F12 каждые 2 с — inbound bytesReceived vs outbound bytesSent. */
function stopWebRtcStatsLogger() {
  if (webrtcStatsTimer) {
    clearInterval(webrtcStatsTimer);
    webrtcStatsTimer = null;
  }
}

function startWebRtcStatsLogger(session, label = "call") {
  stopWebRtcStatsLogger();
  inboundRtpWarnShown = false;
  webrtcStatsTimer = setInterval(() => {
    const pc = session?.sessionDescriptionHandler?.peerConnection;
    if (!pc || pc.connectionState === "closed") {
      stopWebRtcStatsLogger();
      return;
    }
    pc.getStats()
      .then((stats) => {
        const byId = new Map();
        stats.forEach((r) => byId.set(r.id, r));
        let inbound = null;
        let outbound = null;
        let pair = null;
        stats.forEach((r) => {
          if (r.type === "inbound-rtp" && (r.kind === "audio" || r.mediaType === "audio")) inbound = r;
          if (r.type === "outbound-rtp" && (r.kind === "audio" || r.mediaType === "audio")) outbound = r;
          if (r.type === "candidate-pair" && r.state === "succeeded") pair = r;
        });
        const localCand = pair ? byId.get(pair.localCandidateId) : null;
        const remoteCand = pair ? byId.get(pair.remoteCandidateId) : null;
        const inB = inbound?.bytesReceived ?? 0;
        const outB = outbound?.bytesSent ?? 0;
        const level = inB > 5000 ? "info" : "warn";
        const msg =
          `[CC-RTP ${label}] ice=${pc.iceConnectionState} in=${inB || "NO-inbound-rtp"} out=${outB} ` +
          `local=${localCand?.address || "?"}:${localCand?.port || "?"} ` +
          `remote=${remoteCand?.address || "?"}:${remoteCand?.port || "?"} ` +
          `tracks=${collectInboundAudioTracks(session).length}`;
        if (level === "warn") console.warn(msg);
        else console.info(msg);
        if (!inboundRtpWarnShown && outB > 40000 && inB < 5000) {
          inboundRtpWarnShown = true;
          const host = state.config?.domain || defaultTelephonyHost();
          toast(
            "Звонок принят, но голос абонента не слышен (in=NO-inbound-rtp). " +
              `На ПК: PowerShell от администратора → scripts/install-agent-firewall.ps1 ` +
              `(UDP с ${host}). Без прав админа будет «Отказано в доступе».`,
            "warn",
            15000
          );
        }
      })
      .catch((e) => console.warn("[CC-RTP stats]", e));
  }, 2000);
}

/** Нативный запрос Chrome (как для микрофона) — только Notification API. */
async function requestCallNotifications() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") return;
  if (Notification.permission === "denied") return;
  try {
    await Notification.requestPermission();
  } catch { /* ignore */ }
}

function notifyIncomingCall(number, queue) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification("Входящий звонок", {
      body: `${number || "—"}${queue ? ` · очередь ${queue}` : ""}`,
      tag: "cc-inbound-call",
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
      unlockAudioPlayback();
    };
  } catch { /* ignore */ }
}

function showUnlockAudioButton() {
  const b = document.getElementById("btn-unlock-audio");
  if (b) b.hidden = false;
}

function hideUnlockAudioButton() {
  const b = document.getElementById("btn-unlock-audio");
  if (b) b.hidden = true;
}

/** Разблокировка autoplay в жесте клика (без сброса srcObject). */
function unlockAudioPlayback() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && !window.__ccAudioCtx) {
      const ctx = new Ctx();
      window.__ccAudioCtx = ctx;
      if (ctx.state === "suspended") void ctx.resume();
    } else if (window.__ccAudioCtx?.state === "suspended") {
      void window.__ccAudioCtx.resume();
    }
  } catch (_) { /* ignore */ }
  const el = getRemoteAudioEl();
  if (!el.srcObject) {
    el.muted = true;
    const p = el.play();
    if (p?.then) {
      p.then(() => {
        el.pause();
        el.currentTime = 0;
        el.muted = false;
      }).catch(() => { el.muted = false; });
    } else el.muted = false;
  }
  hideUnlockAudioButton();
}

function getRemoteAudioEl() {
  if (!remoteAudioEl) {
    remoteAudioEl = document.getElementById("sip-remote-audio");
    if (!remoteAudioEl) {
      remoteAudioEl = document.createElement("audio");
      remoteAudioEl.id = "sip-remote-audio";
      document.body.appendChild(remoteAudioEl);
    }
    remoteAudioEl.autoplay = true;
    remoteAudioEl.playsInline = true;
    remoteAudioEl.volume = 1;
    remoteAudioEl.muted = false;
  }
  return remoteAudioEl;
}

function resetRemotePlaybackStream() {
  if (remotePlaybackStream) {
    remotePlaybackStream.getTracks().forEach((t) => {
      try { remotePlaybackStream.removeTrack(t); } catch (_) { /* ignore */ }
    });
  }
  remotePlaybackStream = null;
  const el = getRemoteAudioEl();
  if (el) el.srcObject = null;
}

function getOrCreateRemotePlaybackStream() {
  if (!remotePlaybackStream) {
    remotePlaybackStream = new MediaStream();
    getRemoteAudioEl().srcObject = remotePlaybackStream;
  }
  return remotePlaybackStream;
}

function collectInboundAudioTracks(session) {
  const sdh = session?.sessionDescriptionHandler;
  const pc = sdh?.peerConnection;
  const out = [];
  const remote = sdh?.remoteMediaStream;
  if (remote?.getAudioTracks) {
    remote.getAudioTracks().forEach((t) => {
      if (t.readyState !== "ended") out.push(t);
    });
  }
  if (!out.length && pc) {
    pc.getReceivers().forEach((r) => {
      if (r.track?.kind === "audio" && r.track.readyState !== "ended") out.push(r.track);
    });
  }
  return out;
}

/** SIP.js attach-media: один srcObject, треки добавляем в bucket. */
async function syncRemoteAudioFromSession(session, { notify = false } = {}) {
  const tracks = collectInboundAudioTracks(session);
  if (!tracks.length) return false;

  const bucket = getOrCreateRemotePlaybackStream();
  bucket.getAudioTracks().forEach((t) => {
    if (!tracks.includes(t)) {
      try { bucket.removeTrack(t); } catch (_) { /* ignore */ }
    }
  });
  tracks.forEach((t) => {
    if (!bucket.getTracks().includes(t)) {
      try { bucket.addTrack(t); } catch (_) { /* ignore */ }
    }
  });

  const el = getRemoteAudioEl();
  el.muted = false;
  try {
    await el.play();
    hideUnlockAudioButton();
    console.info("remote audio: playing", tracks.length, "track(s)");
    return true;
  } catch (e) {
    if (e?.name !== "AbortError") {
      console.warn("remote audio play", e);
      showUnlockAudioButton();
      if (notify) toast("Нажмите «🔊 Звук» на панели", "warn", 6000);
    }
    return false;
  }
}

function queueSyncRemoteAudio(session, notify = false) {
  clearTimeout(remoteSyncTimer);
  return new Promise((resolve) => {
    remoteSyncTimer = setTimeout(async () => {
      resolve(await syncRemoteAudioFromSession(session, { notify }));
    }, 50);
  });
}

async function waitForRemoteAudio(session, notify = false, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await queueSyncRemoteAudio(session, notify)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function waitForSessionEstablished(session, SessionState, timeoutMs = 20000) {
  if (session.state === SessionState.Established) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SIP session establish timeout")), timeoutMs);
    session.stateChange.addListener((s) => {
      if (s === SessionState.Established) {
        clearTimeout(timer);
        resolve();
      } else if (s === SessionState.Terminated) {
        clearTimeout(timer);
        reject(new Error("call ended before establish"));
      }
    });
  });
}

function setCallMuted(muted) {
  const pc = state.sipCall?.sessionDescriptionHandler?.peerConnection;
  pc?.getSenders().forEach((s) => {
    if (s.track?.kind === "audio") s.track.enabled = !muted;
  });
}

// ---- Call actions ----
async function onAnswer() {
  if (!state.call || !state.sipCall) return;
  if (warnInsecureMicrophone()) return;
  // Только синхронный unlock в клике — await getUserMedia() ломает autoplay для play().
  unlockAudioPlayback();
  try {
    await state.sipCall.accept({
      sessionDescriptionHandlerOptions: {
        constraints: audioConstraints,
      },
    });
    if (SipSessionState && state.sipCall.state !== SipSessionState.Established) {
      await waitForSessionEstablished(state.sipCall, SipSessionState, 20000);
    }
    startWebRtcStatsLogger(state.sipCall, "answered");
    const ok = await waitForRemoteAudio(state.sipCall, true, 12000);
    if (!ok) {
      toast("Нет RTP в браузер — F12→[CC-RTP], проверьте UDP 10000-20000 и WSS :8089", "warn", 10000);
    }
    state.call.phase = "answered";
    state.call.startedAt = Date.now();
    setAgentState("BUSY");
    renderCallInfo();
  } catch (err) {
    console.error("accept failed", err);
    const msg = err?.message || String(err);
    if (/insecure contexts/i.test(msg)) {
      toast(`Откройте Agent по HTTPS: ${agentHttpsUrl()}`, "err", 15000);
    } else {
      toast(`Не удалось ответить: ${msg}`, "err", 10000);
    }
  }
}
function onHangup() {
  if (!state.call) return;
  const c = state.call;
  if (state.sipCall) { try { state.sipCall.terminate(); } catch {} }
  pushHistory({
    time: fmtTime(),
    queue: c.queue,
    number: c.number,
    dur: Math.max(0, (Date.now() - (c.startedAt || Date.now()))/1000),
    outcome: c.phase === "answered" ? "answered" : "missed",
    wrap: "",
    rec: true,
    profile: c.profile,
  });
  const handled = c.profile?.msisdn || c.number;
  const lastSr = state.serviceRequests.find(r => r.handled === handled && r.content);
  if (lastSr) $("#wrap-note").value = lastSr.content.slice(0, 300);
  stopWebRtcStatsLogger();
  releaseAgentMicrophone();
  clearTimeout(remoteSyncTimer);
  resetRemotePlaybackStream();
  state.call = null;
  state.sipCall = null;
  const ra = getRemoteAudioEl();
  if (ra) ra.pause?.();
  renderCallInfo();
  setAgentState("AFTERCALL");
  $("#wrap-timer").textContent = "10s";
}
function onMute() {
  if (!state.call) return;
  state.call.muted = !state.call.muted;
  setCallMuted(state.call.muted);
  toast(state.call.muted ? "Микрофон выключен" : "Микрофон включён", "info", 1200);
}
function onHold() {
  if (!state.call) return;
  state.call.held = !state.call.held;
  toast(state.call.held ? "Удержание включено" : "Удержание снято", "info", 1200);
}
function onTransfer() {
  const target = prompt("Перевести на номер / очередь:");
  if (!target) return;
  toast(`Перевод на ${target}`, "info");
  if (state.sipCall?.refer) state.sipCall.refer(target);
  onHangup();
}
function onConference() {
  const room = prompt("Номер конференц-комнаты:", "100");
  if (!room) return;
  toast(`Конференция *80 ${room}`, "info");
}
function sendDtmf(seq) {
  if (state.sipCall?.sessionDescriptionHandler?.sendDtmf) {
    state.sipCall.sessionDescriptionHandler.sendDtmf(seq);
  }
  toast(`DTMF: ${seq}`, "info", 1200);
}
async function startOutbound(num) {
  try {
    const res = await apiGet(`/subscribers/${encodeURIComponent(num)}`);
    if (res.profile) fillCustomer(res.profile);
  } catch { /* карточка опциональна */ }
  toast("Исходящий вызов — через SIP к Asterisk (WSS)", "info");
}

function nextSN() {
  const base = "260519" + Math.floor(100000000 + Math.random()*899999999);
  return base.slice(0, 15);
}

// ---- SIP.js (real) ----
function scheduleSipReconnect(reason) {
  if (sipReconnectTimer) return;
  sipConnectAttempt += 1;
  if (sipConnectAttempt > 8) {
    toast(`SIP: слишком много попыток (${reason}). Обновите страницу.`, "err", 12000);
    return;
  }
  const delay = Math.min(20000, 2500 * sipConnectAttempt);
  $("#conn-pill").dataset.c = "warn";
  $("#conn-text").textContent = `reconnect ${sipConnectAttempt}…`;
  sipReconnectTimer = setTimeout(() => {
    sipReconnectTimer = null;
    startSip();
  }, delay);
}

async function stopSipUa() {
  if (state.registerer) {
    try {
      await state.registerer.unregister();
    } catch { /* ignore */ }
    state.registerer = null;
  }
  if (state.ua) {
    try {
      await state.ua.stop();
    } catch { /* ignore */ }
    state.ua = null;
  }
}

async function startSip() {
  if (sipReconnectTimer) {
    clearTimeout(sipReconnectTimer);
    sipReconnectTimer = null;
  }
  await stopSipUa();
  $("#conn-pill").dataset.c = "warn";
  $("#conn-text").textContent = "connecting…";
  if (!state.config.pass) {
    $("#conn-pill").dataset.c = "err";
    $("#conn-text").textContent = "error";
    toast("Нет SIP-пароля — выйдите и войдите снова (пароль из админки)", "err", 8000);
    return;
  }
  let wss = (state.config.wss || "").trim();
  if (window.location.protocol === "http:" && wss.startsWith("wss://")) {
    try {
      const u = new URL(wss);
      u.protocol = "ws:";
      if (!u.port || u.port === "8089") u.port = "8088";
      wss = u.toString();
      state.config.wss = wss;
      saveConfig(state.config);
    } catch {
      wss = defaultWssUrl();
      state.config.wss = wss;
      saveConfig(state.config);
    }
  }
  if (window.location.protocol === "https:" && wss.startsWith("ws://")) {
    try {
      const u = new URL(wss);
      u.protocol = "wss:";
      if (!u.port || u.port === "8088") u.port = "8089";
      wss = u.toString();
      state.config.wss = wss;
      saveConfig(state.config);
    } catch {
      wss = defaultWssUrl();
      state.config.wss = wss;
      saveConfig(state.config);
    }
  }
  if (!wss) {
    wss = defaultWssUrl();
    state.config.wss = wss;
  }
  const sipTransportOk =
    (wss.startsWith("wss://") || wss.startsWith("ws://")) && wss.includes("/ws");
  if (!sipTransportOk) {
    toast(
      "Укажите WebSocket SIP: ws://172.16.6.183:8088/ws (HTTP) или wss://172.16.6.183:8089/ws (HTTPS)",
      "err",
      9000
    );
    return;
  }
  try {
    const { UserAgent, Registerer, SessionState, RegistererState, TransportState } =
      await import("https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm");
    SipSessionState = SessionState;
    const uri = UserAgent.makeURI(`sip:${state.config.user}@${state.config.domain}`);
    state.ua = new UserAgent({
      uri,
      transportOptions: {
        server: wss,
        connectionTimeout: 20,
        keepAliveInterval: 30,
      },
      authorizationUsername: state.config.user,
      authorizationPassword: state.config.pass,
      sessionDescriptionHandlerFactoryOptions: {
        constraints: audioConstraints,
        peerConnectionConfiguration: buildPeerConnectionConfiguration(
          resolveTelephonySettings(state.config || {}, await loadTelephonyDefaults())
        ),
        peerConnectionDelegate: {
          ontrack: () => {
            if (state.sipCall) void queueSyncRemoteAudio(state.sipCall, false);
          },
        },
      },
      delegate: {
        onInvite(invitation) {
          state.sipCall = invitation;
          state.call = {
            dir: "in",
            phase: "ringing",
            number: invitation.remoteIdentity.uri.user,
            calling: invitation.remoteIdentity.uri.user,
            called: invitation.request.getHeader("To") || state.config.user,
            sn: nextSN(),
            queue:  invitation.request.getHeader("X-Queue") || null,
            group:  invitation.request.getHeader("X-Group") || null,
            profile: parseProfileHeader(invitation.request.getHeader("X-Profile")),
          };
          if (state.call.profile) fillCustomer(state.call.profile);
          else {
            const num = state.call.number;
            apiGet(`/subscribers/${encodeURIComponent(num)}`).then(res => {
              if (res?.profile) {
                state.call.profile = res.profile;
                fillCustomer(res.profile);
              }
            }).catch(() => {});
          }
          renderCallInfo();
          notifyIncomingCall(state.call.number, state.call.queue);
          invitation.stateChange.addListener((s) => {
            if (s === SessionState.Established) {
              unlockAudioPlayback();
              startWebRtcStatsLogger(invitation, "established");
              void queueSyncRemoteAudio(invitation, false);
            }
            if (s === SessionState.Terminated) onHangup();
          });
        },
      },
    });
    await state.ua.start();
    state.ua.transport?.stateChange?.addListener((ts) => {
      if (ts === TransportState.Disconnected && !state.sipCall) {
        $("#conn-pill").dataset.c = "err";
        $("#conn-text").textContent = "disconnected";
        setAgentState("OFFLINE");
        scheduleSipReconnect("WebSocket closed");
      }
    });
    const registerer = new Registerer(state.ua);
    state.registerer = registerer;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("REGISTER timeout 15s")), 15000);
      const onState = (st) => {
        if (st === RegistererState.Registered) {
          clearTimeout(timer);
          registerer.stateChange.removeListener(onState);
          resolve();
        }
      };
      registerer.stateChange.addListener(onState);
      registerer.register({
        requestDelegate: {
          onReject: (response) => {
            clearTimeout(timer);
            registerer.stateChange.removeListener(onState);
            const code = response?.message?.statusCode || "?";
            const reason = response?.message?.reasonPhrase || "reject";
            reject(new Error(`REGISTER ${code} ${reason}`));
          },
        },
      }).catch((e) => {
        clearTimeout(timer);
        registerer.stateChange.removeListener(onState);
        reject(e);
      });
    });
    const regStatus = await verifyAsteriskRegistration();
    const registered = regStatus === "ok";
    const verified = regStatus !== "unverified";
    $("#conn-pill").dataset.c = registered ? "ok" : "warn";
    $("#conn-text").textContent = registered
      ? "registered"
      : verified ? "no contact" : "unverified";
    // Браузер уже зарегистрировался по SIP; если AMI-проверку выполнить не удалось,
    // не выводим агента в OFFLINE из-за сбоя внутреннего API — только при явном "no contact".
    setAgentState(registered || !verified ? "READY" : "OFFLINE");
    sipConnectAttempt = 0;
  } catch (err) {
    console.error(err);
    $("#conn-pill").dataset.c = "err";
    $("#conn-text").textContent = "error";
    const host = resolveTelephonySettings(state.config || {}, {}).domain;
    const detail = err?.message || String(err);
    const certUrl = state.config?.cert_url || `https://${host}:8089/static/index.html`;
    if (/example\.local/i.test(wss)) {
      toast("В WSS указан cc.example.local — обновите страницу (Ctrl+F5), должен быть IP сервера", "err", 12000);
      return;
    }
    let hint = `Не удалось подключиться: ${detail}`;
    if (/certificate|cert|ssl|SEC_ERROR/i.test(detail)) {
      hint += `. Примите сертификат: ${certUrl} или используйте ws://…:8088/ws (UI по HTTP).`;
    } else if (/WebSocket|timeout|REGISTER/i.test(detail)) {
      hint += `. Проверьте ${wss}, пароль SIP (agent1001), F12→Console.`;
    } else {
      hint += `. WSS: ${wss}, SIP ${state.config.user}@${host}.`;
    }
    toast(hint, "err", 12000);
    if (/WebSocket|1006|REGISTER|timeout|closed/i.test(detail)) {
      scheduleSipReconnect(detail);
    }
  }
}
function parseProfileHeader(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** @returns {Promise<"ok"|"no-contact"|"unverified">} */
async function verifyAsteriskRegistration() {
  const ext = state.config?.user || "1001";
  try {
    const r = await apiGet(`/ops/sip/registration?ext=${encodeURIComponent(ext)}`);
    if (r?.ok && r.registered) return "ok";
    const cert = state.config?.cert_url || `https://${state.config.domain}:8089/static/index.html`;
    toast(
      `SIP в браузере есть, Asterisk не видит ${ext} (pjsip show contacts пусто). ` +
        `Проверьте WSS ${state.config.wss} и сертификат: ${cert}`,
      "warn",
      12000
    );
    return "no-contact";
  } catch (e) {
    console.warn("verifyAsteriskRegistration: AMI-проверку выполнить не удалось", e);
    return "unverified";
  }
}

// ============================================================
// SECTION: История
// ============================================================
function renderFullHistory() {
  const period = $("#fl-period").value;
  const queue  = $("#fl-queue").value;
  const oc     = $("#fl-outcome").value;
  const q      = $("#fl-search").value.trim();
  const now    = Date.now();
  const from   = period === "today" ? new Date(new Date().setHours(0,0,0,0)).getTime() :
                 now - (parseInt(period,10) * 86400 * 1000);
  const rows = state.history.filter(h =>
       (!queue || h.queue === queue)
    && (!oc    || h.outcome === oc)
    && (!q     || h.number.includes(q))
    && (h.date?.getTime() >= from)
  );
  const tb = $("#hist-full tbody"); tb.innerHTML = "";
  for (const h of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${h.date.toLocaleDateString()}</td>
      <td>${h.time}</td>
      <td>${h.queue}</td>
      <td>${h.number}</td>
      <td>${fmtDuration(h.dur)}</td>
      <td>${h.wrap || "—"}</td>
      <td><span class="tag ${h.outcome==='answered'?'ok':h.outcome==='failed'?'err':'warn'}">${h.outcome}</span></td>
      <td>${h.rec ? `<button class="btn ghost" data-rec="${h.number}">▶ Прослушать</button>` : "—"}</td>`;
    tb.appendChild(tr);
  }
  $$("[data-rec]").forEach(b => b.addEventListener("click", () => toast("Доступ к записи логируется в audit_log", "info")));
}
$("#fl-apply").addEventListener("click", renderFullHistory);
$("#fl-export").addEventListener("click", () => toast("Экспорт CSV — в разработке", "info"));

// ============================================================
// SECTION: База знаний
// ============================================================
const KB = [
  { folder: "Тарифы", items: [
    { title: "R3045 — описание", body: `<p>Безлимит на сеть, 30 ГБ интернета, минуты на другие сети 100.</p>
       <h4>Подключение</h4><p>USSD: <code>*100*1*3045#</code>, через приложение, через КЦ.</p>` },
    { title: "R7000 — VIP",       body: `<p>Премиальный сегмент, выделенная линия, бесплатный роуминг.</p>` },
    { title: "Архивные тарифы",   body: `<p>R1000 / R2010 / R2500 — переход возможен в обе стороны.</p>` },
  ]},
  { folder: "Услуги", items: [
    { title: "Перевод на VIP-очередь", body: `<p>Используйте <code>9</code> в IVR или AttendedTransfer на номер очереди.</p>` },
    { title: "Платные подписки", body: `<p>Отключение: <code>STOP</code> на 9999. Возврат — через КЦ.</p>` },
  ]},
  { folder: "FAQ", items: [
    { title: "Как обработать жалобу на качество", body: `<ol><li>Уточнить локацию и время.</li><li>Снять контактный номер.</li><li>Создать тикет category=Quality.</li><li>Перевести на технического оператора при необходимости.</li></ol>` },
    { title: "Что говорить при недозвоне", body: `<p>Стандартный скрипт «Извините за ожидание…», предложить callback.</p>` },
  ]},
  { folder: "Скрипты", items: [
    { title: "Приветствие", body: `<p>«Здравствуйте, [имя]. Вы позвонили в Контакт-центр. Меня зовут [имя оператора]. Чем могу помочь?»</p>` },
    { title: "Прощание", body: `<p>«Спасибо за обращение. Если вопросов больше нет, хорошего дня!»</p>` },
  ]},
];
function renderKb() {
  const tree = $("#kb-tree"); tree.innerHTML = "";
  KB.forEach((folder, i) => {
    const f = document.createElement("div");
    f.className = "folder" + (i === 0 ? " open" : "");
    f.innerHTML = `<span class="chev">▸</span> ${folder.folder}`;
    f.addEventListener("click", () => f.classList.toggle("open"));
    tree.appendChild(f);
    const items = document.createElement("div");
    items.className = "items";
    folder.items.forEach(it => {
      const a = document.createElement("div");
      a.className = "item";
      a.textContent = it.title;
      a.addEventListener("click", () => {
        $$(".kb-tree .item").forEach(x => x.classList.remove("active"));
        a.classList.add("active");
        $("#kb-title").textContent = it.title;
        $("#kb-meta").textContent  = `${folder.folder} · обновлено ${new Date().toLocaleDateString()}`;
        $("#kb-body").innerHTML    = it.body;
      });
      items.appendChild(a);
    });
    tree.appendChild(items);
  });
  const first = $(".kb-tree .item");
  if (first) first.click();
}
$("#kb-search").addEventListener("input", e => {
  const q = e.target.value.toLowerCase();
  $$(".kb-tree .item").forEach(it => {
    it.style.display = it.textContent.toLowerCase().includes(q) ? "" : "none";
  });
});

// ============================================================
// SECTION: Перерывы
// ============================================================
function renderBreaks() {
  const tb = $("#breaks-tbl tbody"); tb.innerHTML = "";
  let total = 0;
  for (const b of state.breaks) {
    const dur = Math.floor(((b.end || Date.now()) - b.start)/1000);
    total += dur;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(b.start).toLocaleTimeString()}</td>
      <td>${b.end ? new Date(b.end).toLocaleTimeString() : "<span class='tag warn'>в процессе</span>"}</td>
      <td>${fmtDuration(dur)}</td>
      <td>${b.reason}</td>`;
    tb.appendChild(tr);
  }
  $("#breaks-total").textContent = `${Math.floor(total/60)} мин`;
}
$("#break-start").addEventListener("click", () => {
  if (state.currentBreak) return;
  const reason = $("#break-reason-sel").value;
  state.currentBreak = { start: Date.now(), reason };
  $("#break-reason").textContent = `на перерыве: ${reason}`;
  setAgentState("PAUSE");
  toast("Asterisk: *13" + reason + " отправлено", "info");
  renderBreaks();
});
$("#break-stop").addEventListener("click", () => {
  if (!state.currentBreak) return;
  state.currentBreak.end = Date.now();
  state.breaks.unshift(state.currentBreak);
  state.currentBreak = null;
  $("#break-timer").textContent = "00:00";
  $("#break-reason").textContent = "не на перерыве";
  setAgentState("READY");
  toast("Asterisk: *14 отправлено", "info");
  renderBreaks();
});

// ============================================================
// SECTION: Каталог обращений (services_catalog.json)
// ============================================================
async function loadCatalog() {
  try {
    const [catR, skDoc] = await Promise.all([
      fetch("services_catalog.json", { cache: "no-store" }),
      loadSkillQueues(),
    ]);
    state.catalog = catR.ok ? await catR.json() : { version: 0, categories: [], skill_queues: [] };
    state.catalog.skill_queues = skDoc.skill_queues || [];
  } catch (err) {
    console.error(err);
    toast("Не удалось загрузить каталог", "err");
    state.catalog = { version: 0, categories: [], skill_queues: [] };
  }
}

function renderCatalogAdmin() {
  $("#cat-version").textContent = `v${state.catalog.version} · ${state.catalog.updated_at || "—"}`;
  const cats = $("#cat-cats tbody"); cats.innerHTML = "";
  for (const c of state.catalog.categories) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${c.id}</td><td>${c.name}</td><td>${c.items.length}</td>`;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => {
      $$("#cat-cats tbody tr").forEach(x => x.style.background = "");
      tr.style.background = "var(--bg-2)";
      $("#cat-cat-title").textContent = `Пункты: ${c.name}`;
      $("#cat-items tbody").innerHTML = c.items.map(i =>
        `<tr><td>${i.id}</td><td><span class="kbd">${i.code}</span></td><td>${i.name}</td></tr>`
      ).join("");
    });
    cats.appendChild(tr);
  }
  if (state.catalog.categories.length) $("#cat-cats tbody tr:first-child").click();
}
$("#cat-reload").addEventListener("click", async () => {
  await loadCatalog(); renderCatalogAdmin(); toast("Каталог перезагружен", "ok");
});
$("#cat-export").addEventListener("click", () => exportCatalog());
$("#cat-import").addEventListener("change", async e => {
  const file = e.target.files[0]; if (!file) return;
  const text = await file.text();
  try {
    const parsed = JSON.parse(text);
    if (!parsed.categories) throw new Error("missing categories");
    state.catalog = parsed;
    renderCatalogAdmin();
    toast("Каталог импортирован (в памяти). Сохраните services_catalog.json для боевого применения.", "ok");
  } catch (err) {
    toast("Ошибка импорта: " + err.message, "err");
  }
});

function exportCatalog() {
  const blob = new Blob([JSON.stringify(state.catalog, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "services_catalog.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  toast("services_catalog.json экспортирован", "ok");
}

// ============================================================
// Popular Service Type modal + Handle / TT card (screen 2)
// ============================================================
let svcActiveCat = null;
let svcSelected = new Set();
let ttDraft = null; // { cat, item, index, handleNumber, editingSn? }
let ttActiveTab = "tasks";

function openServiceModal() {
  const num = $("#cf-handled").value.trim();
  if (!num) { toast("Сначала укажите Handled number", "warn"); return; }
  $("#svc-handle").textContent = num;
  svcSelected = new Set();
  renderSvcCats();
  $("#svc-modal").classList.add("show");
}
$("#btn-fix-service").addEventListener("click", openServiceModal);
$("#svc-close").addEventListener("click",  () => $("#svc-modal").classList.remove("show"));
$("#svc-cancel").addEventListener("click", () => $("#svc-modal").classList.remove("show"));
$("#svc-export").addEventListener("click", exportCatalog);

$("#svc-do-search").addEventListener("click", () => renderSvcItems(svcActiveCat, $("#svc-search").value.trim().toLowerCase()));
$("#svc-do-clear").addEventListener("click",  () => { $("#svc-search").value = ""; renderSvcItems(svcActiveCat, ""); });
$("#svc-search").addEventListener("input",    e  => renderSvcItems(svcActiveCat, e.target.value.trim().toLowerCase()));

function renderSvcCats() {
  const host = $("#svc-cat-list"); host.innerHTML = "";
  for (const c of state.catalog.categories) {
    const d = document.createElement("div");
    d.className = "cat-item";
    d.textContent = c.name;
    d.addEventListener("click", () => {
      svcActiveCat = c;
      $$(".svc-cats .cat-item").forEach(x => x.classList.remove("active"));
      d.classList.add("active");
      renderSvcItems(c, $("#svc-search").value.trim().toLowerCase());
    });
    host.appendChild(d);
  }
  // open first
  const first = state.catalog.categories[0];
  if (first) {
    svcActiveCat = first;
    $(".svc-cats .cat-item")?.classList.add("active");
    renderSvcItems(first, "");
  }
}

function findCatalogItem(itemId) {
  for (const c of state.catalog.categories) {
    const idx = c.items.findIndex(it => it.id === itemId);
    if (idx >= 0) return { cat: c, item: c.items[idx], index: idx };
  }
  return null;
}

function findCatalogItemByCode(code) {
  for (const c of state.catalog.categories) {
    const idx = c.items.findIndex(it => it.code === code);
    if (idx >= 0) return { cat: c, item: c.items[idx], index: idx };
  }
  return null;
}

function buildTypePath(cat, item, index) {
  const leaf = item.handle_title || `${index + 1}) ${item.name}`;
  const parts = [];
  if (cat.breadcrumb_parent) parts.push(cat.breadcrumb_parent);
  parts.push(`${cat.name} (выбрать подпункты!!!)`);
  parts.push(leaf);
  return parts.join(" -> ");
}

function openHandleDetail(cat, item, index, { editingSn = null } = {}) {
  const handleNumber = ($("#svc-handle").textContent || $("#cf-handled").value || "").trim();
  if (!handleNumber || handleNumber === "—") {
    toast("Укажите Handle number", "warn");
    return;
  }
  ttDraft = { cat, item, index, handleNumber, editingSn };
  ttActiveTab = "tasks";
  $$("#tt-tabs .tt-tab").forEach(t => t.classList.toggle("active", t.dataset.ttTab === "tasks"));
  const title = item.handle_title || `${index + 1}) ${item.name}`;
  $("#tt-title").textContent = title;
  $("#tt-subcode").textContent = `${index + 1}) ${item.name} · код ${item.code}`;
  $("#tt-type-path").textContent = buildTypePath(cat, item, index);
  $("#tt-handle").value = handleNumber;
  $("#tt-call-group").value = state.call?.queue || $("#ci-group").textContent?.trim() || "support";
  $("#tt-content").value = editingSn
    ? (state.serviceRequests.find(r => r.sn === editingSn)?.content || "")
    : "";
  renderTtTabContent();
  $("#tt-modal").classList.add("show");
  $("#tt-content").focus();
}

function closeHandleDetail(returnToSvc = true) {
  $("#tt-modal").classList.remove("show");
  ttDraft = null;
  if (returnToSvc && $("#svc-handle").textContent) $("#svc-modal").classList.add("show");
}

function appendHandleLog(sr, action) {
  if (!sr.handleLog) sr.handleLog = [];
  sr.handleLog.unshift({
    time: new Date().toISOString(),
    action,
    staff: state.config?.user || ccSession.login,
    snippet: (sr.content || "").slice(0, 120),
  });
}

function renderTtTabContent() {
  if (!ttDraft) return;
  const { handleNumber, item } = ttDraft;
  const tab = ttActiveTab;
  const showLogPanel = tab === "log";
  $("#tt-log-panel").toggleAttribute("hidden", !showLogPanel);
  $("#tt-task-tbl").toggleAttribute("hidden", showLogPanel);

  if (showLogPanel) {
    const sr = ttDraft.editingSn
      ? state.serviceRequests.find(r => r.sn === ttDraft.editingSn)
      : state.serviceRequests.find(r => r.handled === handleNumber && r.code === item.code);
    const lines = (sr?.handleLog || []).map(l =>
      `[${new Date(l.time).toLocaleString()}] ${l.action} · ${l.staff}\n  ${l.snippet || "—"}`
    );
    if (sr?.content) lines.unshift(`Текущий Service content:\n${sr.content}`);
    $("#tt-log-text").textContent = lines.length ? lines.join("\n\n") : "Лог появится после Save / Submit.";
    $("#tt-empty").classList.add("hidden");
    $("#tt-total").classList.add("hidden");
    return;
  }

  let rows = state.serviceRequests.filter(sr => sr.handled === handleNumber);
  if (tab === "same") rows = rows.filter(sr => sr.code === item.code);
  if (tab === "repeat") {
    rows = rows.filter(sr => sr.status === "submitted" || sr.progress === "Urge");
    if (!rows.length) {
      rows = [{
        sn: "—", ttSn: "—", handled: handleNumber, time: new Date().toISOString(),
        type: item.handle_title || item.name, progress: "—", customerName: "—", content: "",
        status: "draft", code: item.code,
      }];
    }
  }
  if (tab === "handle-info") {
    rows = rows.filter(sr => sr.code === item.code && sr.content);
  }

  const tbody = $("#tt-task-tbl tbody");
  const head = $("#tt-task-head");
  const custName = $("#cf-name").value?.trim() || "—";
  const withContent = tab === "handle-info";
  head.innerHTML = withContent
    ? `<tr><th>SN</th><th>Код</th><th>Service content</th><th>Progress</th><th></th></tr>`
    : `<tr><th style="width:28px"></th><th>Operation</th><th>SN</th><th>TT SN</th><th>Handle number</th><th>Handle time</th><th>Service request type</th><th>Handle progress</th><th>Customer name</th></tr>`;

  tbody.innerHTML = rows.map(sr => {
    if (withContent) {
      const preview = (sr.content || "—").slice(0, 80);
      return `<tr>
        <td>${sr.sn}</td>
        <td><span class="kbd">${sr.code}</span></td>
        <td title="${(sr.content || "").replace(/"/g, "&quot;")}">${preview}${(sr.content || "").length > 80 ? "…" : ""}</td>
        <td><span class="tag">${sr.progress || sr.status}</span></td>
        <td><button type="button" class="btn ghost tt-open" data-sn="${sr.sn}">View</button></td>
      </tr>`;
    }
    return `<tr>
      <td><input type="checkbox" /></td>
      <td><button type="button" class="btn ghost tt-open" data-sn="${sr.sn}">View</button></td>
      <td>${sr.sn}</td>
      <td>${sr.ttSn || "—"}</td>
      <td>${sr.handled}</td>
      <td>${new Date(sr.time).toLocaleString()}</td>
      <td>${sr.type}</td>
      <td><span class="tag ${sr.status === "submitted" ? "ok" : "warn"}">${sr.progress || sr.status}</span></td>
      <td>${sr.customerName || custName}</td>
    </tr>`;
  }).join("");

  const empty = !rows.length || (tab === "repeat" && rows[0]?.sn === "—");
  $("#tt-empty").classList.toggle("hidden", !empty);
  $("#tt-total").classList.toggle("hidden", empty);
  $("#tt-empty").textContent = tab === "repeat"
    ? "Sorry, no matching records"
    : "Нет записей по этому номеру";
  $("#tt-total").textContent = `Total ${empty ? 0 : rows.length} records`;

  tbody.querySelectorAll(".tt-open").forEach(btn => {
    btn.addEventListener("click", () => {
      const sr = state.serviceRequests.find(r => r.sn === btn.dataset.sn);
      if (!sr) return;
      const found = findCatalogItemByCode(sr.code);
      if (found) openHandleDetail(found.cat, found.item, found.index, { editingSn: sr.sn });
      else {
        $("#tt-content").value = sr.content || "";
        toast("Редактирование записи", "info");
      }
    });
  });
}

function renderTtTaskTable(handleNumber, codeFilter = null) {
  renderTtTabContent();
}

function saveHandleRecord(status, progress) {
  if (!ttDraft) return null;
  const content = $("#tt-content").value.trim();
  if (!content) {
    toast("Заполните Service content — о чём говорили с абонентом", "warn");
    $("#tt-content").focus();
    return null;
  }
  const { cat, item, index, handleNumber, editingSn } = ttDraft;
  const typeLabel = item.handle_title || `${index + 1}) ${item.name}`;
  const now = new Date().toISOString();
  let sr = editingSn ? state.serviceRequests.find(r => r.sn === editingSn) : null;
  const patch = {
    type: typeLabel,
    code: item.code,
    category: cat.name,
    typePath: buildTypePath(cat, item, index),
    content,
    callGroup: $("#tt-call-group").value.trim(),
    queue: $("#tt-call-group").value.trim() || state.call?.queue || "support",
    time: now,
    status,
    progress,
    customerName: $("#cf-name").value?.trim() || "",
  };
  if (sr) {
    if (!sr.handleLog) sr.handleLog = [];
    Object.assign(sr, patch);
  } else {
    sr = {
      sn: "SR" + Math.floor(100000 + Math.random() * 899999),
      ttSn: "TT" + Math.floor(100000 + Math.random() * 899999),
      staff: state.config?.user || ccSession.login,
      handled: handleNumber,
      handleLog: [],
      ...patch,
    };
    state.serviceRequests.unshift(sr);
  }
  appendHandleLog(sr, progress);
  if (status === "submitted" && !ttDraft.editingSn) {
    const lastSr = state.serviceRequests.find(r => r.sn === sr.sn);
    if (lastSr) $("#wrap-note").value = content.slice(0, 200);
  }
  renderSRTabs();
  renderTtTabContent();
  return sr;
}

function renderSvcItems(cat, q = "") {
  const host = $("#svc-items"); host.innerHTML = "";
  if (!cat) return;
  cat.items.forEach((it, i) => {
    if (q && !(it.name.toLowerCase().includes(q) || it.code.toLowerCase().includes(q))) return;
    const row = document.createElement("div");
    row.className = "item-row";
    const checked = svcSelected.has(it.id) ? "checked" : "";
    row.innerHTML = `
      <input type="checkbox" data-id="${it.id}" ${checked}/>
      <div class="item-body">
        <span class="name">${i + 1}) ${it.name}</span>
        <span class="code">${it.code}</span>
      </div>`;
    const cb = row.querySelector("input");
    cb.addEventListener("click", e => e.stopPropagation());
    cb.addEventListener("change", e => {
      if (e.target.checked) svcSelected.add(it.id);
      else svcSelected.delete(it.id);
    });
    row.querySelector(".item-body").addEventListener("click", () => {
      openHandleDetail(cat, it, i);
      $("#svc-modal").classList.remove("show");
    });
    row.addEventListener("dblclick", () => {
      openHandleDetail(cat, it, i);
      $("#svc-modal").classList.remove("show");
    });
    host.appendChild(row);
  });
  if (!host.children.length) {
    host.innerHTML = `<div style="padding: 14px; color: var(--fg-2)">Ничего не найдено.</div>`;
  }
}

$("#svc-fill").addEventListener("click", () => {
  if (!svcSelected.size) { toast("Выберите подпункт или кликните по строке", "warn"); return; }
  const found = findCatalogItem([...svcSelected][0]);
  if (!found) { toast("Пункт не найден", "err"); return; }
  if (svcSelected.size > 1) {
    toast(`Открыта карточка для первого пункта (выбрано: ${svcSelected.size})`, "info");
  }
  openHandleDetail(found.cat, found.item, found.index);
  $("#svc-modal").classList.remove("show");
});

$("#tt-close-x").addEventListener("click", () => closeHandleDetail(true));
$("#tt-cancel").addEventListener("click", () => closeHandleDetail(true));
$("#tt-modal").addEventListener("click", e => {
  if (e.target.id === "tt-modal") closeHandleDetail(true);
});
$("#tt-submit").addEventListener("click", () => {
  const sr = saveHandleRecord("submitted", "Submitted");
  if (!sr) return;
  toast(`Обращение ${sr.sn} отправлено`, "ok");
  closeHandleDetail(false);
  $("#svc-modal").classList.remove("show");
});
$("#tt-save").addEventListener("click", () => {
  const sr = saveHandleRecord("draft", "Saved");
  if (sr) toast(`Черновик ${sr.sn} сохранён`, "ok");
});
$("#tt-prehandle").addEventListener("click", () => {
  const sr = saveHandleRecord("prehandle", "Prehandle");
  if (sr) toast("Prehandle сохранён", "ok");
});
$("#tt-direct").addEventListener("click", () => {
  const sr = saveHandleRecord("closed", "Direct Reply");
  if (!sr) return;
  toast("Direct Reply — обращение закрыто", "ok");
  closeHandleDetail(false);
  $("#svc-modal").classList.remove("show");
});
$("#tt-modify").addEventListener("click", () => {
  $("#tt-content").focus();
  toast("Редактирование Service content", "info");
});
$("#tt-import").addEventListener("click", () => toast("Import — фаза 2", "info"));
$("#tt-export-row").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({
    handle: $("#tt-handle").value,
    callGroup: $("#tt-call-group").value,
    content: $("#tt-content").value,
    typePath: $("#tt-type-path").textContent,
  }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "handle-export.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#tt-back-svc").addEventListener("click", () => {
  closeHandleDetail(true);
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if ($("#tt-modal").classList.contains("show")) closeHandleDetail(true);
});
$$("#tt-tabs .tt-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    $$("#tt-tabs .tt-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    ttActiveTab = tab.dataset.ttTab;
    if (["same", "repeat"].includes(ttActiveTab)) {
      toast(`${tab.textContent} — данные из CRM/TT при подключении`, "info", 2000);
    }
    renderTtTabContent();
  });
});

// ---- Boot ----
renderCallInfo();
async function bootAgent() {
  if (!hasPermission(ccSession, "workspace.view") && ccSession.role !== "admin") {
    toast("Нет прав на рабочую область", "err");
    location.href = "../index.html";
    return;
  }
  showSipModal();
}
bootAgent();
