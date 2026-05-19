import { $, $$, fmtDuration, fmtTime, toast, loadConfig, saveConfig } from "../shared/common.js";
import {
  requireSession,
  clearSession,
  hasPermission,
  resolveSkillIdsFromQueues,
} from "../shared/auth.js";

const ccSession = requireSession({ roles: ["agent", "admin"], redirect: "../index.html" });
if (!ccSession) throw new Error("no session");

const state = {
  config: null,
  ua: null,
  sipCall: null,
  agentState: "OFFLINE",
  stateSince: Date.now(),
  call: null,             // active call: { dir, phase, number, name, queue, profile, startedAt, sn, mdn, group, calling, called }
  history: [],
  queues: [
    { name: "support", waiting: 0, longest: 0, sla: 0.0 },
    { name: "sales",   waiting: 0, longest: 0, sla: 0.0 },
    { name: "billing", waiting: 0, longest: 0, sla: 0.0 },
    { name: "vip",     waiting: 0, longest: 0, sla: 0.0 },
    { name: "overflow",waiting: 0, longest: 0, sla: 0.0 },
  ],
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
function showSipModal() {
  const saved = loadConfig() || {};
  const sip = ccSession.sipUser || saved.user || "1001";
  $("#sip-who").textContent = `${ccSession.fullName} · ${ccSession.login} (${ccSession.roleLabel})`;
  $("#cfg-user").value = sip;
  $("#cfg-wss").value = saved.wss || "wss://cc.example.local:8089/ws";
  $("#cfg-domain").value = saved.domain || "cc.example.local";
  $("#cfg-demo").checked = saved.demo ?? true;
  $("#sip-modal").classList.add("show");
}
function hideSipModal() {
  $("#sip-modal").classList.remove("show");
  $("#app").style.display = "grid";
}

function buildConfig(demoOverride) {
  const saved = loadConfig() || {};
  const demo = demoOverride ?? saved.demo ?? true;
  return {
    user: ccSession.sipUser || saved.user || "1001",
    pass: ccSession.sipPassword || "",
    wss: ($("#cfg-wss")?.value || saved.wss || "wss://cc.example.local:8089/ws").trim(),
    domain: ($("#cfg-domain")?.value || saved.domain || "cc.example.local").trim(),
    demo,
    login: ccSession.login,
  };
}

async function beginWorkspace() {
  state.config = buildConfig($("#cfg-demo")?.checked);
  saveConfig(state.config);
  hideSipModal();
  $("#who").textContent = `${ccSession.fullName} · ${ccSession.login}`;
  if (ccSession.role === "admin") {
    $("#btn-admin").hidden = false;
    $("#btn-admin").addEventListener("click", () => { location.href = "../admin/"; });
  }
  await loadCatalog();
  await enterShift();
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

function finishShiftStart() {
  if (state.config.demo) startDemo();
  else startSip();
  showSection(location.hash.replace("#", "") || "workspace");
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
$("#skills-cancel").addEventListener("click", () => $("#skills-modal").classList.remove("show"));
$("#skills-close").addEventListener("click",  () => $("#skills-modal").classList.remove("show"));
$("#skills-ok").addEventListener("click", () => {
  applySkillIds([...state.selectedSkills]);
  $("#skills-modal").classList.remove("show");
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
function onQuery() {
  const num = $("#cf-handled").value.trim();
  if (!num) { toast("Введите Handled number", "warn"); return; }
  toast(`Query subscriber ${num} (REST /api/subscribers/${num})`, "info");
  // demo: fill with synthetic data
  if (state.config?.demo) fillCustomer(syntheticProfile(num));
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
  const note = $("#wrap-note").value;
  if (!outcome) { toast("Заполните результат", "warn"); return; }
  toast(`Wrap сохранён: ${outcome}`, "ok");
  $("#wrap-outcome").value = "";
  $("#wrap-note").value = "";
  setAgentState("READY");
});

// ---- Refresh sidebar / SR / call info ----
$("#ci-refresh").addEventListener("click", () => { renderCallInfo(); renderQueues(); toast("Refreshed", "info", 800); });
$("#btn-refresh-sr").addEventListener("click", () => renderSRTabs());

// ---- Tabs in customer lower panel ----
$$("#sr-tabs .tab").forEach(t => t.addEventListener("click", () => {
  $$("#sr-tabs .tab").forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  const name = t.dataset.tab;
  $$(".tab-pane").forEach(p => p.toggleAttribute("hidden", p.dataset.pane !== name));
}));

// ---- State machine ----
function setAgentState(s) {
  state.agentState = s;
  state.stateSince = Date.now();
  const pill = $("#state-pill");
  pill.dataset.state = s;
  $("#state-text").textContent = s;
  if (state.config?.demo && s === "READY") simulateIncomingSoon();
  toast(`Статус: ${s}`, "info", 1200);
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
  title.classList.remove("busy","ringing","arrange");
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
  title.classList.add(c.phase === "ringing" ? "ringing" : "busy");
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
  // populate lower tabs with demo data
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
  const fmtRow = (sr) => `<tr>
    <td>${sr.sn}</td>
    <td>${sr.type}</td>
    <td><span class="kbd">${sr.code}</span></td>
    <td>${new Date(sr.time).toLocaleString()}</td>
    <td>${sr.queue}</td>
    <td>${sr.staff}</td>
    <td><span class="tag ${sr.status==='closed'?'ok':'warn'}">${sr.status}</span></td>
    <td><button class="btn ghost" data-srx="${sr.sn}">Details</button></td>
  </tr>`;
  $("#sr-tbl tbody").innerHTML = state.serviceRequests.map(fmtRow).join("");

  $("#tt-tbl tbody").innerHTML = state.relatedTT.map(t => `
    <tr><td>${t.no}</td><td>${t.cat}</td><td>${t.created}</td><td>${t.assigned}</td>
    <td><span class="tag ${t.status==='closed'?'ok':'warn'}">${t.status}</span></td></tr>`).join("");

  $("#cr-tbl tbody").innerHTML = state.callRedirects.map(r => `
    <tr><td>${r.from}</td><td>${r.to}</td><td>${r.type}</td><td>${r.active?"Да":"Нет"}</td></tr>`).join("");

  $("#pl-tbl tbody").innerHTML = state.productList.map(p => `
    <tr><td>${p.name}</td><td><span class="tag ${p.active?'ok':''}">${p.active?'active':'inactive'}</span></td>
    <td>${p.since}</td><td>${p.fee}</td></tr>`).join("");
}

function renderQueues() {
  const tb = $("#queues-tbl tbody");
  tb.innerHTML = "";
  for (const q of state.queues) {
    const tr = document.createElement("tr");
    const cls = q.waiting >= 5 ? "err" : q.waiting >= 2 ? "warn" : "ok";
    tr.innerHTML = `
      <td>${q.name}</td>
      <td><span class="tag ${cls}">${q.waiting}</span></td>
      <td>${fmtDuration(q.longest)}</td>
      <td>${Math.round((q.sla||0)*100)}%</td>`;
    tb.appendChild(tr);
  }
}

function pushHistory(row) {
  row.date = new Date();
  state.history.unshift(row);
  if (state.history.length > 500) state.history.pop();
}

// ---- Call actions ----
function onAnswer() {
  if (!state.call) return;
  if (state.sipCall?.accept) state.sipCall.accept();
  state.call.phase = "answered";
  state.call.startedAt = Date.now();
  setAgentState("BUSY");
  renderCallInfo();
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
  state.call = null;
  state.sipCall = null;
  renderCallInfo();
  setAgentState("AFTERCALL");
  $("#wrap-timer").textContent = "10s";
}
function onMute() {
  if (!state.call) return;
  state.call.muted = !state.call.muted;
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
function startOutbound(num) {
  if (state.config.demo) {
    state.call = {
      dir: "out", number: num, calling: state.config.user, called: num,
      phase: "answered", startedAt: Date.now(),
      sn: nextSN(), queue: null, group: "Outbound",
      profile: syntheticProfile(num),
    };
    fillCustomer(state.call.profile);
    setAgentState("BUSY");
    renderCallInfo();
    return;
  }
  toast("Исходящий через SIP.js будет реализован при подключении к Asterisk", "warn");
}

function nextSN() {
  const base = "260519" + Math.floor(100000000 + Math.random()*899999999);
  return base.slice(0, 15);
}

function syntheticProfile(msisdn) {
  const names = ["Тагоев Сорбон Абду-карарович", "Иван Петров", "Ситора Каримова", "Daler Nazarov"];
  const tariffs = ["Длиен412","R3045","R7000","R2010"];
  const cats = ["Физическое лицо","Юридическое лицо","VIP","Корпоративный"];
  const groups = ["Tajikskaya gruppa", "Russian group", "VIP group"];
  return {
    msisdn,
    name: names[Math.floor(Math.random()*names.length)],
    tariff: tariffs[Math.floor(Math.random()*tariffs.length)],
    imsi: "4365" + Math.floor(1000000000 + Math.random()*8999999999),
    pin1: "0000", puk1: "12345678", pin2: "0000", puk2: "87654321",
    core_balance: (Math.random()*200).toFixed(2),
    balance: (Math.random()*200).toFixed(2),
    category: cats[Math.floor(Math.random()*cats.length)],
    customer_code: (1 + Math.random()).toFixed(7),
    account_code: String(400000 + Math.floor(Math.random()*100000)),
    icc: "8999225" + Math.floor(1000000000 + Math.random()*8999999999),
    group: groups[Math.floor(Math.random()*groups.length)],
    requests: [],
    tickets:  [],
    redirects: [{ from: msisdn, to: "*100*1#", type: "Безусловная", active: false }],
    products: [
      { name: "MobiSMS/MMS все направления", active: true, since: "2024-08-12", fee: "2.50 TJS" },
      { name: "MobiMINUTE внутр.", active: false, since: "2023-12-01", fee: "1.00 TJS" },
    ],
  };
}

// ---- SIP.js (real) ----
async function startSip() {
  $("#conn-pill").dataset.c = "warn";
  $("#conn-text").textContent = "connecting…";
  try {
    const { UserAgent, Registerer, SessionState } = await import("https://cdn.jsdelivr.net/npm/sip.js@0.21.2/+esm");
    const uri = UserAgent.makeURI(`sip:${state.config.user}@${state.config.domain}`);
    state.ua = new UserAgent({
      uri,
      transportOptions: { server: state.config.wss },
      authorizationUsername: state.config.user,
      authorizationPassword: state.config.pass,
      sessionDescriptionHandlerFactoryOptions: { constraints: { audio: true, video: false } },
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
          renderCallInfo();
          invitation.stateChange.addListener(s => {
            if (s === SessionState.Terminated) onHangup();
          });
        },
      },
    });
    await state.ua.start();
    const registerer = new Registerer(state.ua);
    await registerer.register();
    $("#conn-pill").dataset.c = "ok";
    $("#conn-text").textContent = "registered";
    setAgentState("READY");
  } catch (err) {
    console.error(err);
    $("#conn-pill").dataset.c = "err";
    $("#conn-text").textContent = "error";
    toast("Не удалось подключиться к Asterisk WSS, переходим в демо", "warn");
    state.config.demo = true;
    startDemo();
  }
}
function parseProfileHeader(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// ---- Demo mode ----
function startDemo() {
  $("#conn-pill").dataset.c = "ok";
  $("#conn-text").textContent = "demo";
  setAgentState("READY");
  seedHistory();
  setInterval(() => {
    for (const q of state.queues) {
      q.waiting = Math.max(0, q.waiting + (Math.random() < 0.4 ? 1 : -1));
      q.longest = q.waiting > 0 ? Math.min(180, (q.longest || 0) + 2 + Math.floor(Math.random()*3)) : 0;
      q.sla = Math.max(0.6, Math.min(1, (q.sla || 0.9) + (Math.random() - 0.5) * 0.05));
    }
    renderQueues();
  }, 2500);
}
function simulateIncomingSoon() {
  if (!state.config?.demo) return;
  if (state.call) return;
  setTimeout(() => {
    if (state.agentState !== "READY") return;
    const number = ["918441995","985471881","918614129","935123456"][Math.floor(Math.random()*4)];
    const p = syntheticProfile(number);
    const queue = ["support","sales","billing","vip"][Math.floor(Math.random()*4)];
    state.call = {
      dir: "in", phase: "ringing",
      number, calling: number, called: "2006",
      sn: nextSN(), queue, group: p.group, waited: Math.floor(Math.random()*30),
      profile: p,
    };
    fillCustomer(p);
    renderCallInfo();
    toast(`Входящий: ${p.name} (${number})`, "info", 4000);
  }, 4000 + Math.random()*6000);
}

function seedHistory() {
  const queues = ["support","sales","billing","vip"];
  const outcomes = ["answered","answered","answered","answered","missed"];
  const now = Date.now();
  for (let i = 0; i < 60; i++) {
    const t = new Date(now - i * (180000 + Math.random()*240000));
    const dur = Math.floor(20 + Math.random()*420);
    const number = "9" + Math.floor(10000000 + Math.random()*89999999);
    state.history.push({
      time: t.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit", second:"2-digit"}),
      date: t,
      queue: queues[Math.floor(Math.random()*queues.length)],
      number, dur,
      outcome: outcomes[Math.floor(Math.random()*outcomes.length)],
      wrap: ["Решено","Решено","Тикет создан","Эскалация","Перезвонить"][Math.floor(Math.random()*5)],
      rec: Math.random() < 0.9,
    });
  }
  state.history.sort((a,b) => b.date - a.date);
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
      <td><span class="tag ${h.outcome==='answered'?'ok':'warn'}">${h.outcome}</span></td>
      <td>${h.rec ? `<button class="btn ghost" data-rec="${h.number}">▶ Прослушать</button>` : "—"}</td>`;
    tb.appendChild(tr);
  }
  $$("[data-rec]").forEach(b => b.addEventListener("click", () => toast("Доступ к записи логируется в audit_log", "info")));
}
$("#fl-apply").addEventListener("click", renderFullHistory);
$("#fl-export").addEventListener("click", () => toast("CSV сгенерирован (демо)", "ok"));

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
    const r = await fetch("services_catalog.json", { cache: "no-store" });
    state.catalog = await r.json();
  } catch (err) {
    console.error(err);
    toast("Не удалось загрузить services_catalog.json", "err");
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
// Popular Service Type modal
// ============================================================
let svcActiveCat = null;
let svcSelected = new Set();

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

function renderSvcItems(cat, q = "") {
  const host = $("#svc-items"); host.innerHTML = "";
  if (!cat) return;
  cat.items.forEach((it, i) => {
    if (q && !(it.name.toLowerCase().includes(q) || it.code.toLowerCase().includes(q))) return;
    const row = document.createElement("label");
    row.className = "item-row";
    const checked = svcSelected.has(it.id) ? "checked" : "";
    row.innerHTML = `
      <input type="checkbox" data-id="${it.id}" ${checked}/>
      <div>
        <span>${i+1}) ${it.name}</span>
        <span class="code">${it.code}</span>
      </div>`;
    row.querySelector("input").addEventListener("change", e => {
      if (e.target.checked) svcSelected.add(it.id); else svcSelected.delete(it.id);
    });
    host.appendChild(row);
  });
  if (!host.children.length) {
    host.innerHTML = `<div style="padding: 14px; color: var(--fg-2)">Ничего не найдено.</div>`;
  }
}

$("#svc-fill").addEventListener("click", () => {
  if (!svcSelected.size) { toast("Выберите хотя бы один пункт", "warn"); return; }
  const handled = $("#svc-handle").textContent;
  let added = 0;
  for (const c of state.catalog.categories) {
    for (const it of c.items) {
      if (!svcSelected.has(it.id)) continue;
      added++;
      state.serviceRequests.unshift({
        sn: "SR" + Math.floor(100000 + Math.random()*899999),
        type: it.name,
        code: it.code,
        category: c.name,
        time: new Date().toISOString(),
        queue: state.call?.queue || "support",
        staff: state.config.user,
        status: "open",
        handled,
      });
    }
  }
  renderSRTabs();
  $("#svc-modal").classList.remove("show");
  toast(`Создано Service Requests: ${added}. Они будут отправлены в /api/tickets`, "ok");
});

// ---- Boot ----
renderQueues();
renderCallInfo();
async function bootAgent() {
  if (!hasPermission(ccSession, "workspace.view") && ccSession.role !== "admin") {
    toast("Нет прав на рабочую область", "err");
    location.href = "../index.html";
    return;
  }
  const saved = loadConfig() || {};
  const demo = saved.demo ?? true;
  if (demo) {
    state.config = buildConfig(true);
    saveConfig(state.config);
    hideSipModal();
    $("#who").textContent = `${ccSession.fullName} · ${ccSession.login}`;
    if (ccSession.role === "admin") {
      $("#btn-admin").hidden = false;
      $("#btn-admin").onclick = () => { location.href = "../admin/"; };
    }
    await loadCatalog();
    await enterShift();
  } else {
    showSipModal();
  }
}
bootAgent();
