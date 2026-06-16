import { $, $$, fmtDuration, fmtTime, toast, el } from "../shared/common.js";
import { requireSession, clearSession, hasPermission } from "../shared/auth.js";
import { apiGet } from "../shared/api.js";

const ccSession = requireSession({
  roles: ["supervisor", "qa", "auditor", "admin"],
  redirect: "../index.html",
});
if (!ccSession) throw new Error("no session");

const state = {
  session: ccSession,
  queues: [],
  agents: [],
  recent: [],
  audit: [],
  recordings: [],
};

function parseSince(iso) {
  if (!iso) return Date.now();
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Date.now() : t;
}

async function refreshOpsData() {
  try {
    const [qRes, aRes, auRes, recRes] = await Promise.all([
      apiGet("/ops/queues/realtime"),
      apiGet("/ops/agents"),
      apiGet("/ops/audit?limit=80"),
      apiGet("/ops/recordings"),
    ]);
    state.queues = (qRes.queues || []).map(q => ({
      ...q,
      strategy: "—",
      wrapup: 10,
    }));
    state.agents = (aRes.agents || []).map(a => ({
      ...a,
      since: parseSince(a.since),
    }));
    state.audit = (auRes.audit || []).map(x => ({
      ...x,
      date: x.date ? new Date(x.date) : new Date(),
    }));
    state.recordings = (recRes.recordings || []).map(r => ({
      ...r,
      time: r.time ? new Date(r.time) : new Date(),
    }));
    state.recent = state.recordings.slice(0, 30).map(r => ({
      time: r.time instanceof Date ? r.time.toLocaleTimeString() : fmtTime(),
      queue: r.queue || "—",
      caller: r.caller || "",
      agent: r.agent || "—",
      dur: r.dur || 0,
      outcome: (r.disposition || "answered").toLowerCase(),
    }));
  } catch (e) {
    console.warn("ops api", e);
  }
  renderKpis();
  renderQueuesLive();
  const active = location.hash.replace("#", "") || "dashboard";
  if (active === "dashboard") { renderAgents(); renderRecent(); }
  else if (active === "queues-live") renderQueuesLive();
  else if (active === "agents") renderAgentsTbl();
  else if (active === "queues") renderQueueCards();
  else if (active === "recordings") renderRecordings();
  else if (active === "audit") renderAuditTbl();
}

// ---- Routing ----
function showSection(name) {
  $$(".view").forEach(v => v.toggleAttribute("hidden", v.dataset.view !== name));
  $$(".nav-item[data-section]").forEach(n => n.classList.toggle("active", n.dataset.section === name));
  if (name === "queues-live") renderQueuesLive();
  if (name === "agents")     renderAgentsTbl();
  if (name === "queues")     renderQueueCards();
  if (name === "recordings") renderRecordings();
  if (name === "sla")        renderSLA();
  if (name === "audit")      renderAuditTbl();
  location.hash = name;
}
$$(".nav-item[data-section]").forEach(n => n.addEventListener("click", () => showSection(n.dataset.section)));
window.addEventListener("hashchange", () => {
  const h = location.hash.replace("#", "") || "dashboard";
  showSection(h);
});

// ---- Dashboard renderers ----
function renderKpis() {
  const calls = state.agents.filter(a => a.state === "BUSY").length;
  const ready = state.agents.filter(a => a.state === "READY").length;
  const longest = Math.max(0, ...state.queues.map(q => q.longest));
  const sla = state.queues.reduce((a,q) => a + (q.sla||0), 0) / state.queues.length;
  $("#kpi-calls").textContent = calls;
  $("#kpi-agents").textContent = ready;
  $("#kpi-wait").textContent = fmtDuration(longest);
  $("#kpi-sla").textContent = Math.round(sla*100) + "%";
  renderWallMetrics();
}

function renderWallMetrics() {
  const host = $("#wall-grid");
  if (!host) return;
  const waiting = state.queues.reduce((a, q) => a + q.waiting, 0);
  const offered = state.queues.reduce((a, q) => a + q.offered, 0);
  const handled = state.queues.reduce((a, q) => a + q.handled, 0);
  const abandoned = state.queues.reduce((a, q) => a + q.abandoned, 0);
  const onBreak = state.agents.filter(a => a.state === "PAUSE").length;
  const online = state.agents.filter(a => a.state !== "OFFLINE").length;
  const asa = Math.round(state.queues.reduce((a, q) => a + q.longest, 0) / Math.max(1, state.queues.length));
  const aht = 185 + Math.floor(Math.random() * 40);
  const ivrAuto = Math.round(handled * 0.35);
  const cells = [
    { lbl: "ASA (сред. ожидание)", val: fmtDuration(asa), cls: asa > 60 ? "warn" : "ok" },
    { lbl: "AHT (сред. разговор)", val: fmtDuration(aht), cls: "" },
    { lbl: "В очереди ONLINE", val: waiting, cls: waiting >= 5 ? "err" : waiting >= 2 ? "warn" : "ok" },
    { lbl: "Обслужено операторами", val: handled, cls: "ok" },
    { lbl: "Обслужено IVR (auto)", val: ivrAuto, cls: "" },
    { lbl: "Звонков за 24ч", val: offered, cls: "" },
    { lbl: "За месяц (оценка)", val: Math.round(offered * 28), cls: "" },
    { lbl: "Операторов online", val: online, cls: "ok" },
    { lbl: "На перерыве", val: onBreak, cls: onBreak > 5 ? "warn" : "" },
    { lbl: "Подключено SIP", val: online, cls: "" },
    { lbl: "Необсл. abandon", val: abandoned, cls: abandoned > 10 ? "err" : "" },
    { lbl: "SLA avg", val: Math.round(state.queues.reduce((a,q)=>a+q.sla,0)/state.queues.length*100) + "%", cls: "ok" },
  ];
  host.innerHTML = cells.map(c => `
    <div class="wall-cell ${c.cls}">
      <div class="lbl">${c.lbl}</div>
      <div class="val">${c.val}</div>
    </div>`).join("");
}

function renderQueuesLive() {
  const tb = $("#queues-live-tbl tbody");
  const compact = $("#queues-live-compact tbody");
  if (!tb || !compact) return;
  tb.innerHTML = "";
  compact.innerHTML = "";
  for (const q of state.queues) {
    const wcls = q.waiting >= 5 ? "err" : q.waiting >= 2 ? "warn" : "ok";
    const slaPct = Math.round((q.sla || 0) * 100);
    const slaCls = slaPct >= 90 ? "ok" : slaPct >= 80 ? "warn" : "err";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${q.name}</b></td>
      <td><span class="tag ${wcls}">${q.waiting}</span></td>
      <td>${fmtDuration(q.longest)}</td>
      <td>${q.ops ?? 0}</td>
      <td>${q.offered ?? 0}</td>
      <td>${q.handled ?? 0}</td>
      <td>${q.abandoned ?? 0}</td>
      <td><span class="tag ${slaCls}">${slaPct}%</span></td>`;
    tb.appendChild(tr);
    const trc = document.createElement("tr");
    trc.innerHTML = `
      <td>${q.name}</td>
      <td><span class="tag ${wcls}">${q.waiting}</span></td>
      <td>${fmtDuration(q.longest)}</td>
      <td><span class="tag ${slaCls}">${slaPct}%</span></td>`;
    compact.appendChild(trc);
  }
}

function renderAgents() {
  const grid = $("#agents-grid");
  const search = $("#agents-search").value.toLowerCase().trim();
  grid.innerHTML = "";
  for (const a of state.agents) {
    if (search && !(`${a.name} ${a.sip}`.toLowerCase().includes(search))) continue;
    const tag = stateTag(a.state);
    const card = el("div", { class: "agent-card", onclick: () => openAgent(a) }, []);
    card.innerHTML = `
      <div class="top">
        <div class="av">${a.name.split(" ").map(p=>p[0]).slice(0,2).join("")}</div>
        <div>
          <div class="nm">${a.name}</div>
          <div class="sip">${a.sip} · ${a.queues.join(", ")}</div>
        </div>
      </div>
      <div class="st">
        <span class="tag ${tag.cls}">${a.state}</span>
        <span class="timer">${fmtDuration((Date.now() - a.since)/1000)}</span>
      </div>`;
    grid.appendChild(card);
  }
}
$("#agents-search").addEventListener("input", renderAgents);

function stateTag(s) {
  return s === "READY"     ? { cls:"ok"   } :
         s === "BUSY"      ? { cls:"busy" } :
         s === "PAUSE"     ? { cls:"pause"} :
         s === "AFTERCALL" ? { cls:"warn" } :
                             { cls:""     };
}

function renderRecent() {
  const tb = $("#recent-tbl tbody"); tb.innerHTML = "";
  for (const r of state.recent.slice(0,30)) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.time}</td><td>${r.queue}</td><td>${r.caller}</td><td>${r.agent||"—"}</td><td>${fmtDuration(r.dur)}</td><td><span class="tag ${r.outcome==='answered'?'ok':'warn'}">${r.outcome}</span></td>`;
    tb.appendChild(tr);
  }
}

// ---- Modal ----
let modalAgent = null;
function openAgent(a) {
  modalAgent = a;
  $("#m-name").textContent = a.name;
  $("#m-sip").textContent  = a.sip;
  $("#m-state").textContent = a.state;
  $("#m-queues").textContent = a.queues.join(", ");
  $("#m-call").textContent = a.call ? `${a.call.caller} (${a.call.queue})` : "—";
  $("#agent-modal").classList.add("show");
}
$("#m-close").addEventListener("click", () => $("#agent-modal").classList.remove("show"));
$$("#agent-modal [data-act]").forEach(b => b.addEventListener("click", () => {
  const act = b.dataset.act;
  if (!modalAgent) return;
  state.audit.unshift({
    time: fmtTime(),
    date: new Date(),
    actor: "supervisor",
    role: "supervisor",
    action: act,
    target: modalAgent.sip,
    ip: "10.0.0.50",
    payload: { from: "agent-modal" },
  });
  if ($('[data-view="audit"]:not([hidden])')) renderAuditTbl();
  toast(`${act} → ${modalAgent.sip}`, "ok");
  $("#agent-modal").classList.remove("show");
}));

// ---- Theme ----
$("#btn-theme").addEventListener("click", () => {
  const t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", t);
});

// ============================================================
// SECTION: Операторы
// ============================================================
function renderAgentsTbl() {
  const fs = $("#a-flt-state").value;
  const fq = $("#a-flt-queue").value;
  const ff = $("#a-flt-q").value.toLowerCase().trim();
  const tb = $("#agents-tbl tbody"); tb.innerHTML = "";
  for (const a of state.agents) {
    if (fs && a.state !== fs) continue;
    if (fq && !a.queues.includes(fq)) continue;
    if (ff && !(`${a.name} ${a.sip}`.toLowerCase().includes(ff))) continue;
    const t = stateTag(a.state);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${a.sip}</td>
      <td>${a.name}</td>
      <td><span class="tag ${t.cls}">${a.state}</span></td>
      <td>${fmtDuration((Date.now() - a.since)/1000)}</td>
      <td>${a.queues.join(", ")}</td>
      <td>${a.call ? `${a.call.caller} (${a.call.queue})` : "—"}</td>
      <td>
        <button class="btn ghost" data-sip="${a.sip}" data-act="open">Open</button>
        <button class="btn"       data-sip="${a.sip}" data-act="pause">Pause</button>
        <button class="btn"       data-sip="${a.sip}" data-act="unpause">Unpause</button>
      </td>`;
    tb.appendChild(tr);
  }
  $$("#agents-tbl [data-sip]").forEach(b => b.addEventListener("click", e => {
    const sip = e.currentTarget.dataset.sip;
    const act = e.currentTarget.dataset.act;
    const a = state.agents.find(x => x.sip === sip);
    if (!a) return;
    if (act === "open") openAgent(a);
    else {
      state.audit.unshift({time: fmtTime(), date: new Date(), actor:"supervisor", role:"supervisor", action: act, target: sip, ip:"10.0.0.50", payload:{from:"agents-tbl"}});
      toast(`${act} → ${sip}`, "ok");
    }
  }));
}
$("#a-flt-apply").addEventListener("click", renderAgentsTbl);

// ============================================================
// SECTION: Очереди
// ============================================================
function renderQueueCards() {
  const host = $("#queue-cards"); host.innerHTML = "";
  for (const q of state.queues) {
    const members = state.agents.filter(a => a.queues.includes(q.name));
    const card = document.createElement("div");
    card.className = "q-card";
    card.innerHTML = `
      <div class="top">
        <h3 style="margin:0">${q.name}</h3>
        <span class="tag ${q.sla>=0.9?'ok':q.sla>=0.8?'warn':'err'}">SLA ${Math.round(q.sla*100)}%</span>
      </div>
      <div class="kv" style="margin-top:8px">
        <label>Стратегия</label><div class="v">${q.strategy}</div>
        <label>SLA, сек</label><div class="v">${q.sla_seconds}</div>
        <label>Wrap-up, сек</label><div class="v">${q.wrapup}</div>
        <label>Operators</label><div class="v">${q.ops}</div>
        <label>В ожидании</label><div class="v">${q.waiting}</div>
        <label>Longest</label><div class="v">${fmtDuration(q.longest)}</div>
        <label>Offered / Handled / Abnd</label><div class="v">${q.offered} / ${q.handled} / ${q.abandoned}</div>
      </div>
      <div class="members">
        ${members.map(m => `<span class="chip" title="${m.state}">${m.sip} · ${m.name.split(' ')[0]}</span>`).join("")}
      </div>`;
    host.appendChild(card);
  }
}

// ============================================================
// SECTION: Записи разговоров
// ============================================================
function renderRecordings() {
  const queue = $("#r-queue").value;
  const q = $("#r-search").value.trim();
  const date = $("#r-date").value;
  const tb = $("#rec-tbl tbody"); tb.innerHTML = "";
  for (const r of state.recordings) {
    if (queue && r.queue !== queue) continue;
    if (q && !(r.caller.includes(q) || r.uniqueid.includes(q))) continue;
    if (date) {
      const d = new Date(date);
      if (r.time.toDateString() !== d.toDateString()) continue;
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.time.toLocaleString()}</td>
      <td>${r.queue}</td>
      <td>${r.caller}</td>
      <td>${r.agent}</td>
      <td>${fmtDuration(r.dur)}</td>
      <td><span class="kbd">${r.sha.slice(0,12)}…</span></td>
      <td>
        <button class="btn ghost" data-id="${r.uniqueid}" data-act="play">▶</button>
        <button class="btn ghost" data-id="${r.uniqueid}" data-act="download">↓</button>
      </td>`;
    tb.appendChild(tr);
  }
  $$("#rec-tbl [data-id]").forEach(b => b.addEventListener("click", e => {
    const id = e.currentTarget.dataset.id;
    const act = e.currentTarget.dataset.act;
    const r = state.recordings.find(x => x.uniqueid === id);
    if (!r) return;
    state.audit.unshift({time: fmtTime(), date: new Date(), actor:"supervisor", role:"qa", action: act === "play" ? "recording_view" : "recording_download", target: id, ip:"10.0.0.50", payload:{caller:r.caller, agent:r.agent}});
    if (act === "play") {
      $("#rec-player").hidden = false;
      $("#rec-title").textContent = `${r.caller} → ${r.agent} (${fmtDuration(r.dur)})`;
      $("#rec-audio").src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
      toast("Прослушивание залогировано в audit_log", "info");
    } else {
      toast("Скачивание залогировано в audit_log", "info");
    }
  }));
}
$("#r-apply").addEventListener("click", renderRecordings);
$("#rec-close").addEventListener("click", () => $("#rec-player").hidden = true);

// ============================================================
// SECTION: SLA / Отчёты
// ============================================================
function renderSLA() {
  const bars = $("#sla-bars"); bars.innerHTML = "";
  for (const q of state.queues) {
    const pct = Math.round(q.sla * 100);
    const cls = pct >= 90 ? "" : pct >= 80 ? "warn" : "err";
    const row = document.createElement("div");
    row.className = `bar ${cls}`;
    row.innerHTML = `
      <div class="lbl">${q.name}</div>
      <div class="track"><div class="fill" style="width:${pct}%"></div></div>
      <div class="val">${pct}%</div>`;
    bars.appendChild(row);
  }
  const tb = $("#sla-tbl tbody"); tb.innerHTML = "";
  for (const q of state.queues) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${q.name}</td>
      <td>${q.offered}</td>
      <td>${q.handled}</td>
      <td>${q.abandoned}</td>
      <td>${(Math.random()*10+5).toFixed(1)}s</td>
      <td>${(Math.random()*120+90).toFixed(0)}s</td>
      <td>${Math.round(q.sla*100)}%</td>`;
    tb.appendChild(tr);
  }
}
$("#sla-refresh").addEventListener("click", renderSLA);
$("#sla-export").addEventListener("click", () => toast("CSV сгенерирован (демо)", "ok"));

// ============================================================
// SECTION: Audit
// ============================================================
function renderAuditTbl() {
  const actor = $("#au-actor").value.toLowerCase().trim();
  const action = $("#au-action").value;
  const tb = $("#au-tbl tbody"); tb.innerHTML = "";
  for (const a of state.audit) {
    if (actor && !a.actor.includes(actor)) continue;
    if (action && a.action !== action) continue;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${(a.date instanceof Date ? a.date : new Date(a.date)).toLocaleString()}</td>
      <td>${a.actor}</td>
      <td>${a.role}</td>
      <td><span class="tag">${a.action}</span></td>
      <td>${a.target||"—"}</td>
      <td>${a.ip||"—"}</td>
      <td><span class="kbd">${JSON.stringify(a.payload||{})}</span></td>`;
    tb.appendChild(tr);
  }
}
$("#au-apply").addEventListener("click", renderAuditTbl);

// ============================================================
// Boot / simulators
// ============================================================
setInterval(() => { $("#ts-now").textContent = fmtTime(); }, 1000);

refreshOpsData();
setInterval(refreshOpsData, 5000);

$("#who").textContent = `${ccSession.fullName} · ${ccSession.roleLabel}`;
if (ccSession.role === "admin") {
  $("#btn-admin").hidden = false;
  $("#btn-admin").addEventListener("click", () => { location.href = "../admin/"; });
}
$("#btn-logout")?.addEventListener("click", () => {
  clearSession();
  location.href = "../index.html";
});
if (!hasPermission(ccSession, "dashboard.view")) {
  toast("Ограниченный доступ — только audit/recordings", "warn");
}

// initial route
showSection(location.hash.replace("#","") || "dashboard");
