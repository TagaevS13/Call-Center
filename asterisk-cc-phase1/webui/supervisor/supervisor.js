import { $, $$, fmtDuration, fmtTime, toast, el } from "../shared/common.js";
import { requireSession, clearSession, hasPermission } from "../shared/auth.js";

const ccSession = requireSession({
  roles: ["supervisor", "qa", "auditor", "admin"],
  redirect: "../index.html",
});
if (!ccSession) throw new Error("no session");

const state = {
  session: ccSession,
  queues: [
    { name:"support",  waiting:0, longest:0, offered:120, handled:115, abandoned:5, sla:0.92, ops:8,
      strategy:"leastrecent", sla_seconds:20, wrapup:10 },
    { name:"sales",    waiting:0, longest:0, offered:60,  handled:58,  abandoned:2, sla:0.95, ops:5,
      strategy:"ringall",     sla_seconds:15, wrapup:10 },
    { name:"billing",  waiting:0, longest:0, offered:80,  handled:72,  abandoned:8, sla:0.88, ops:6,
      strategy:"fewestcalls", sla_seconds:30, wrapup:15 },
    { name:"vip",      waiting:0, longest:0, offered:30,  handled:30,  abandoned:0, sla:0.99, ops:3,
      strategy:"ringall",     sla_seconds:10, wrapup:10 },
    { name:"overflow", waiting:0, longest:0, offered:10,  handled:8,   abandoned:2, sla:0.80, ops:2,
      strategy:"leastrecent", sla_seconds:60, wrapup:5 },
  ],
  agents: [],
  recent: [],
  audit: [],
  recordings: [],
};

const NAMES = [
  "Anvar M.","Sitora K.","Farrukh A.","Daler N.","Parvina S.","Mavzuna R.",
  "Jamshed I.","Nasrullo H.","Aziz B.","Manizha T.","Shahnoza Y.","Rustam Q.",
];

function genAgents(n=24) {
  const agents = [];
  for (let i=0;i<n;i++) {
    const sip = String(1001+i);
    agents.push({
      id: i+1,
      sip,
      name: NAMES[i % NAMES.length] + " " + sip,
      state: "READY",
      since: Date.now() - Math.floor(Math.random()*900*1000),
      queues: ["support","sales","billing","vip"].filter((_, j)=> (i+j)%2===0).slice(0,2),
      call: null,
    });
  }
  return agents;
}

function seedRecordings() {
  const queues = ["support","sales","billing","vip"];
  const now = Date.now();
  for (let i=0;i<120;i++) {
    const t = new Date(now - i * (60000 + Math.random()*240000));
    state.recordings.push({
      uniqueid: `163${Math.floor(1000000 + Math.random()*8999999)}.${i}`,
      time: t,
      queue: queues[Math.floor(Math.random()*queues.length)],
      caller: "9" + Math.floor(10000000 + Math.random()*89999999),
      agent: String(1001 + Math.floor(Math.random()*24)),
      dur: Math.floor(20 + Math.random()*400),
      sha: Array.from({length:64}, () => "0123456789abcdef"[Math.floor(Math.random()*16)]).join(""),
    });
  }
}

function seedAudit(n=40) {
  const actions = ["listen","whisper","barge","pause","unpause","remove","recording_view","login","logout"];
  const actors = ["supervisor","qa1","qa2","admin","auditor"];
  const now = Date.now();
  for (let i=0;i<n;i++) {
    const t = new Date(now - i * (30000 + Math.random()*240000));
    state.audit.push({
      time: t.toLocaleTimeString(),
      date: t,
      actor: actors[Math.floor(Math.random()*actors.length)],
      role: "supervisor",
      action: actions[Math.floor(Math.random()*actions.length)],
      target: String(1001 + Math.floor(Math.random()*24)),
      ip: `10.0.0.${10 + Math.floor(Math.random()*200)}`,
      payload: {note: "demo"},
    });
  }
}

// ---- Routing ----
function showSection(name) {
  $$(".view").forEach(v => v.toggleAttribute("hidden", v.dataset.view !== name));
  $$(".nav-item[data-section]").forEach(n => n.classList.toggle("active", n.dataset.section === name));
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
}

function renderQueues() {
  const tb = $("#q-tbl tbody"); tb.innerHTML = "";
  for (const q of state.queues) {
    const wcls = q.waiting >= 5 ? "err" : q.waiting >= 2 ? "warn" : "ok";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${q.name}</b></td>
      <td><span class="tag ${wcls}">${q.waiting}</span></td>
      <td>${fmtDuration(q.longest)}</td>
      <td>${q.ops}</td>
      <td>${q.offered} / ${q.handled} / ${q.abandoned}</td>
      <td>${Math.round((q.sla||0)*100)}%</td>`;
    tb.appendChild(tr);
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
      <td>${a.date.toLocaleString()}</td>
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
state.agents = genAgents();
seedRecordings();
seedAudit();
renderQueues(); renderAgents(); renderRecent(); renderKpis();

setInterval(() => { $("#ts-now").textContent = fmtTime(); }, 1000);

setInterval(() => {
  for (const q of state.queues) {
    const delta = (Math.random() < 0.4) ? 1 : -1;
    q.waiting = Math.max(0, q.waiting + delta);
    q.longest = q.waiting > 0 ? Math.min(240, q.longest + 2 + Math.floor(Math.random()*3)) : 0;
    if (Math.random() < 0.3) q.offered += 1;
    if (Math.random() < 0.25) q.handled += 1;
    if (Math.random() < 0.05) q.abandoned += 1;
    q.sla = Math.max(0.6, Math.min(1, q.sla + (Math.random() - 0.5) * 0.02));
  }
  const a = state.agents[Math.floor(Math.random()*state.agents.length)];
  const nextStates = a.state === "READY" ? ["BUSY","PAUSE","READY","READY"] :
                     a.state === "BUSY"  ? ["AFTERCALL","BUSY","BUSY"] :
                     a.state === "AFTERCALL" ? ["READY","READY","AFTERCALL"] :
                     ["READY"];
  const nx = nextStates[Math.floor(Math.random()*nextStates.length)];
  if (nx !== a.state) { a.state = nx; a.since = Date.now(); }
  if (Math.random() < 0.5) {
    state.recent.unshift({
      time: fmtTime(),
      queue: state.queues[Math.floor(Math.random()*state.queues.length)].name,
      caller: "9" + Math.floor(10000000 + Math.random()*89999999),
      agent: a.sip,
      dur: Math.floor(20 + Math.random()*300),
      outcome: Math.random() < 0.9 ? "answered" : "missed",
    });
  }
  renderKpis(); renderQueues();
  // re-render active section if its data changed
  const active = location.hash.replace("#", "") || "dashboard";
  if (active === "dashboard") renderAgents();
  else if (active === "agents") renderAgentsTbl();
  else if (active === "queues") renderQueueCards();
}, 2500);

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
