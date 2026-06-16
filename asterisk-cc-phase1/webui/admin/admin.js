import { $, $$, toast } from "../shared/common.js";
import {
  requireSession,
  clearSession,
  loadUsers,
  loadGroups,
  loadRoles,
  loadSkillQueues,
  loadVdnRoutes,
  loadSubscribersAccess,
  loadCrmConnectors,
  saveUsersOverride,
  saveGroupsOverride,
  saveSkillQueuesOverride,
  saveVdnRoutesOverride,
  saveSubscribersAccessOverride,
  saveCrmConnectorsDoc,
  clearUsersOverride,
  clearGroupsOverride,
  clearSkillQueuesOverride,
  clearVdnRoutesOverride,
  clearSubscribersAccessOverride,
  resolveQueueBindings,
} from "../shared/auth.js";
import { apiPost, apiGet, formatAsteriskSyncToast } from "../shared/api.js";

async function persist(fn, data, okMsg = "Сохранено в БД") {
  const res = await fn(data);
  toast(okMsg, "ok");
  const extra = formatAsteriskSyncToast(res?.asterisk_sync);
  if (extra) toast(extra, res?.asterisk_sync?.ok === false ? "err" : "ok", 5000);
  return res;
}
import {
  normalizeMsisdn,
  isEntryActive,
  resolveEntryQueues,
  LIST_TYPE_LABELS,
  SCOPE_LABELS,
} from "../shared/subscriber_access.js";

const state = {
  session: null,
  usersDoc: null,
  groupsDoc: null,
  skillQueuesDoc: null,
  vdnDoc: null,
  subscribersDoc: null,
  crmDoc: null,
  rolesDoc: null,
  editingCrmId: null,
  catalog: null,
  editingQueueId: null,
  editingUserId: null,
  draftSkills: [],
  draftAgentGroupIds: new Set(),
  pickSelection: new Set(),
  pickerTarget: "agent-skill",
  editingGroupId: null,
  draftGroupQueues: [],
  editingVdnId: null,
  draftLangOptions: [],
  editingSubId: null,
  draftSubGroups: new Set(),
  draftSubQueues: new Set(),
};

state.session = requireSession({ roles: ["admin"] });
if (!state.session) throw new Error("no session");

$("#who").textContent = `${state.session.fullName} (${state.session.role})`;

function showTab(name) {
  $$(".panel").forEach(p => p.classList.toggle("active", p.dataset.panel === name));
  $$(".nav-item[data-tab]").forEach(n => n.classList.toggle("active", n.dataset.tab === name));
}
$$(".nav-item[data-tab]").forEach(n => n.addEventListener("click", () => showTab(n.dataset.tab)));

$("#btn-theme").addEventListener("click", () => {
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === "dark" ? "light" : "dark";
});
$("#btn-logout").addEventListener("click", () => {
  clearSession();
  location.href = "../index.html";
});

function syncCatalogSkillQueues() {
  state.catalog = state.catalog || { skill_queues: [] };
  state.catalog.skill_queues = state.skillQueuesDoc?.skill_queues || [];
}

async function loadCatalogMeta() {
  try {
    const catR = await fetch(new URL("../agent/services_catalog.json", import.meta.url), { cache: "no-store" });
    if (catR.ok) state.catalog = await catR.json();
  } catch { /* demo */ }
  if (!state.catalog) state.catalog = { skill_queues: [] };
  syncCatalogSkillQueues();
}

function nextSkillQueueId() {
  const list = state.skillQueuesDoc?.skill_queues || [];
  return list.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
}

function allSkillOptions() {
  const seen = new Set();
  const out = [];
  for (const s of state.catalog?.skill_queues || []) {
    const name = s.name || s.queue || `skill-${s.id}`;
    const queue = (s.queue || s.name || name).toLowerCase();
    const key = `${s.id}|${queue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ skill_id: s.id, name, queue });
  }
  for (const g of state.groupsDoc?.groups || []) {
    for (const q of g.queues || []) {
      const queue = q.toLowerCase();
      if (seen.has(`q|${queue}`)) continue;
      seen.add(`q|${queue}`);
      const hit = (state.catalog?.skill_queues || []).find(
        s => (s.queue || s.name || "").toLowerCase() === queue
      );
      out.push({
        skill_id: hit?.id ?? null,
        name: hit?.name || q,
        queue,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

/** Skill groups for agents (CSP Skill Group — несколько skill queue внутри). */
function skillGroupsAssignable() {
  return (state.groupsDoc.groups || []).filter(g => {
    if (g.default_role && g.default_role !== "agent") return false;
    return (g.queues?.length || 0) > 0 || g.default_role === "agent";
  });
}

function queueDisplayName(queue) {
  const q = (queue || "").toLowerCase();
  const hit = (state.catalog?.skill_queues || []).find(
    s => (s.queue || s.name || "").toLowerCase() === q
  );
  return hit?.name || queue;
}

function groupDetailsText(g) {
  return (g.queues || []).map(queueDisplayName).join(", ") || "—";
}

function agentSkillsSummary(u) {
  if (u.role !== "agent") return "—";
  if (u.skill_mode === "by_skill" && u.assigned_skills?.length) {
    return u.assigned_skills.map(s => s.name || s.queue).join(", ");
  }
  const bindings = resolveQueueBindings(u, state.groupsDoc);
  if (bindings.length) return bindings.map(b => b.queue).join(", ");
  return "—";
}

function agentGroupsSummary(u) {
  if (u.role !== "agent") return "—";
  if (u.skill_mode === "by_skill") return "— (по навыку)";
  return (u.groups || []).join(", ") || "—";
}

async function boot() {
  await loadCatalogMeta();
  [state.usersDoc, state.groupsDoc, state.skillQueuesDoc, state.vdnDoc, state.subscribersDoc, state.crmDoc, state.rolesDoc] = await Promise.all([
    loadUsers(),
    loadGroups(),
    loadSkillQueues(),
    loadVdnRoutes(),
    loadSubscribersAccess(),
    loadCrmConnectors(),
    loadRoles(),
  ]);
  syncCatalogSkillQueues();
  renderUsers();
  renderRoles();
  renderGroups();
  renderQueuesTable();
  renderQueuesCatalog();
  renderVdnTable();
  renderSubscribersTable();
  renderCrmTable();
}

function renderQueuesCatalog() {
  const tbody = $("#queues-catalog-tbl tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const legacy = [
    { id: 901, name: "support (legacy)", queue: "support", service_type: "Query" },
    { id: 902, name: "sales (legacy)", queue: "sales", service_type: "Query" },
    { id: 903, name: "billing (legacy)", queue: "billing", service_type: "Query" },
    { id: 904, name: "overflow (legacy)", queue: "overflow", service_type: "Query" },
  ];
  const all = [...(state.skillQueuesDoc?.skill_queues || []), ...legacy];
  all.sort((a, b) => a.id - b.id);
  for (const s of all) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="kbd">${s.id}</span></td>
      <td>${s.name}</td>
      <td>${s.queue || s.name}</td>
      <td>${s.service_type || "Query"}</td>`;
    tbody.appendChild(tr);
  }
}

function renderQueuesTable() {
  const tbody = $("#queues-tbl tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const all = [...(state.skillQueuesDoc?.skill_queues || [])];
  all.sort((a, b) => a.id - b.id);
  for (const s of all) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="kbd">${s.id}</span></td>
      <td>${s.name}</td>
      <td>${s.queue || s.name}</td>
      <td>${s.service_type || "Query"}</td>
      <td class="row" style="gap:4px">
        <button class="btn ghost" data-act="edit">✎</button>
        <button class="btn ghost" data-act="del">✕</button>
      </td>`;
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openQueueModal(s));
    tr.querySelector('[data-act="del"]').addEventListener("click", () => deleteSkillQueue(s.id));
    tbody.appendChild(tr);
  }
}

function openQueueModal(s = null) {
  state.editingQueueId = s?.id ?? null;
  $("#queue-modal-title").textContent = s ? `Change Skill Queue — ${s.name}` : "Add Skill Queue";
  $("#qm-id").value = s?.id ?? nextSkillQueueId();
  $("#qm-id").disabled = !!s;
  $("#qm-name").value = s?.name || "";
  $("#qm-queue").value = s?.queue || "";
  $("#qm-type").value = s?.service_type || "Query";
  $("#queue-modal").classList.add("show");
}

async function deleteSkillQueue(id) {
  if (!confirm("Удалить направление (Skill Queue)?")) return;
  state.skillQueuesDoc.skill_queues = (state.skillQueuesDoc.skill_queues || []).filter(s => s.id !== id);
  await persist(saveSkillQueuesOverride, state.skillQueuesDoc);
  syncCatalogSkillQueues();
  renderQueuesTable();
  renderQueuesCatalog();
  toast("Направление удалено", "ok");
}

$("#btn-queue-add").addEventListener("click", () => openQueueModal());
$("#qm-close").addEventListener("click", () => $("#queue-modal").classList.remove("show"));
$("#qm-cancel").addEventListener("click", () => $("#queue-modal").classList.remove("show"));
$("#qm-save").addEventListener("click", async () => {
  const id = parseInt($("#qm-id").value, 10);
  const name = $("#qm-name").value.trim();
  const queue = $("#qm-queue").value.trim().toLowerCase().replace(/\s+/g, "_");
  if (!id || !name || !queue) {
    toast("Заполните ID, название и очередь Asterisk", "warn");
    return;
  }
  const payload = {
    id,
    name,
    queue,
    service_type: $("#qm-type").value,
  };
  const list = state.skillQueuesDoc.skill_queues || [];
  if (state.editingQueueId) {
    const s = list.find(x => x.id === state.editingQueueId);
    if (s) Object.assign(s, payload);
  } else {
    if (list.some(x => x.id === id)) { toast("ID уже занят", "warn"); return; }
    if (list.some(x => (x.queue || "").toLowerCase() === queue)) {
      toast("Очередь с таким именем уже есть", "warn");
      return;
    }
    list.push(payload);
  }
  state.skillQueuesDoc.skill_queues = list;
  await persist(saveSkillQueuesOverride, state.skillQueuesDoc);
  syncCatalogSkillQueues();
  $("#queue-modal").classList.remove("show");
  renderQueuesTable();
  renderQueuesCatalog();
  toast("Skill Queue сохранён", "ok");
});

$("#btn-queues-export").addEventListener("click", () => downloadJson("skill_queues.json", state.skillQueuesDoc));
$("#btn-queues-import").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  state.skillQueuesDoc = JSON.parse(await f.text());
  await persist(saveSkillQueuesOverride, state.skillQueuesDoc);
  syncCatalogSkillQueues();
  renderQueuesTable();
  renderQueuesCatalog();
  toast("skill_queues.json импортирован", "ok");
});

// ---- Users / Agents ----
function renderUsers() {
  const q = ($("#user-filter").value || "").toLowerCase();
  const tbody = $("#users-tbl tbody");
  tbody.innerHTML = "";
  for (const u of state.usersDoc.users || []) {
    const idStr = String(u.sip_user || u.id);
    if (q && !(u.login.toLowerCase().includes(q) || idStr.includes(q) || (u.full_name || "").toLowerCase().includes(q))) continue;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="kbd">${idStr}</span><div style="font-size:11px;color:var(--fg-2)">${u.login}</div></td>
      <td>${u.full_name || "—"}</td>
      <td><span class="badge-role">${u.role}</span></td>
      <td>${agentGroupsSummary(u)}</td>
      <td><span class="skills-summary" title="${agentSkillsSummary(u)}">${agentSkillsSummary(u)}</span></td>
      <td>${u.sip_user || "—"}</td>
      <td>${u.status}</td>
      <td class="row" style="gap:4px">
        <button class="btn ghost" data-act="edit" title="Edit">✎</button>
        <button class="btn ghost" data-act="del" title="Delete">✕</button>
      </td>`;
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openUserModal(u));
    tr.querySelector('[data-act="del"]').addEventListener("click", () => deleteUser(u.id));
    tbody.appendChild(tr);
  }
}

function getSkillMode() {
  const r = document.querySelector('input[name="skill-mode"]:checked');
  return r?.value || "by_group";
}

function toggleSkillModeUi() {
  const isAgent = $("#um-role").value === "agent";
  $("#um-agent-skills").hidden = !isAgent;
  if (!isAgent) return;
  const mode = getSkillMode();
  $("#um-by-group").hidden = mode !== "by_group";
  $("#um-by-skill").hidden = mode !== "by_skill";
}

function renderAgentGroupsTable() {
  const tbody = $("#um-agent-groups-tbl tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const gid of state.draftAgentGroupIds) {
    const g = (state.groupsDoc.groups || []).find(x => x.id === gid);
    if (!g) continue;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${g.name}</td>
      <td>${groupDetailsText(g)}</td>
      <td><button class="btn ghost" data-gid="${gid}">Delete</button></td>`;
    tr.querySelector("button").addEventListener("click", () => {
      state.draftAgentGroupIds.delete(gid);
      renderAgentGroupsTable();
    });
    tbody.appendChild(tr);
  }
}

function renderDraftSkillsTable() {
  const tbody = $("#um-skills-tbl tbody");
  tbody.innerHTML = "";
  for (let i = 0; i < state.draftSkills.length; i++) {
    const sk = state.draftSkills[i];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${sk.name || sk.queue}</td>
      <td><input type="number" min="1" max="16" value="${sk.agent_rating ?? 1}" data-i="${i}" data-f="agent_rating" /></td>
      <td><input type="number" min="1" max="16" value="${sk.skill_rating ?? 1}" data-i="${i}" data-f="skill_rating" /></td>
      <td><input type="number" min="0" max="99" value="${sk.penalty ?? 0}" data-i="${i}" data-f="penalty" /></td>
      <td><button class="btn ghost" data-del="${i}">Delete</button></td>`;
    tr.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("change", e => {
        const idx = parseInt(e.target.dataset.i, 10);
        const f = e.target.dataset.f;
        state.draftSkills[idx][f] = parseInt(e.target.value, 10) || 0;
      });
    });
    tr.querySelector("[data-del]").addEventListener("click", () => {
      state.draftSkills.splice(i, 1);
      renderDraftSkillsTable();
    });
    tbody.appendChild(tr);
  }
}

function openUserModal(user = null) {
  state.editingUserId = user?.id ?? null;
  $("#user-modal-title").textContent = user ? `Change Agent — ${user.full_name || user.login}` : "Add Agent";
  $("#um-login").value = user?.login || "";
  $("#um-password").value = "";
  $("#um-password2").value = "";
  $("#um-name").value = user?.full_name || "";
  $("#um-role").value = user?.role || "agent";
  $("#um-sip").value = user?.sip_user || "";
  $("#um-sippass").value = user?.sip_password || "";
  $("#um-status").value = user?.status || "active";

  const mode = user?.skill_mode || "by_group";
  document.querySelector(`input[name="skill-mode"][value="${mode}"]`).checked = true;
  state.draftAgentGroupIds = new Set(user?.groups || []);
  renderAgentGroupsTable();
  $("#um-pick-skills").checked = user?.pick_skills !== false;

  state.draftSkills = (user?.assigned_skills || []).map(s => ({ ...s }));
  if (!state.draftSkills.length && user?.skill_mode === "by_skill") {
    const bindings = resolveQueueBindings({ ...user, skill_mode: "by_group" }, state.groupsDoc);
    state.draftSkills = bindings.map(b => ({
      queue: b.queue,
      name: b.queue,
      agent_rating: 1,
      skill_rating: 1,
      penalty: b.penalty,
    }));
  }
  renderDraftSkillsTable();
  toggleSkillModeUi();
  $("#user-modal").classList.add("show");
}

function selectedGroupIds() {
  return [...state.draftAgentGroupIds];
}

/** При переходе «По группе» → «По навыку» — очереди из отмеченных групп в таблицу навыков. */
function syncDraftSkillsFromGroups() {
  const groupIds = selectedGroupIds();
  if (!groupIds.length) return;

  const bindings = resolveQueueBindings(
    { role: "agent", skill_mode: "by_group", groups: groupIds },
    state.groupsDoc
  );
  const catalogSkills = state.catalog?.skill_queues || [];
  const prevByQueue = new Map(
    state.draftSkills.map(s => [(s.queue || s.name || "").toLowerCase(), s])
  );

  state.draftSkills = bindings.map(b => {
    const queue = b.queue;
    const key = queue.toLowerCase();
    const prev = prevByQueue.get(key);
    if (prev) return { ...prev };
    const hit = catalogSkills.find(
      s => (s.queue || s.name || "").toLowerCase() === key
    );
    return {
      skill_id: hit?.id ?? null,
      queue,
      name: hit?.name || queue,
      agent_rating: 1,
      skill_rating: 1,
      penalty: b.penalty ?? 0,
    };
  });
  state.draftSkills.sort((a, b) =>
    (a.name || a.queue).localeCompare(b.name || b.queue, "ru")
  );
}

function onSkillModeChange() {
  if (getSkillMode() === "by_skill") {
    syncDraftSkillsFromGroups();
    renderDraftSkillsTable();
  }
  toggleSkillModeUi();
}

async function deleteUser(id) {
  if (!confirm("Удалить пользователя?")) return;
  state.usersDoc.users = (state.usersDoc.users || []).filter(u => u.id !== id);
  await persist(saveUsersOverride, state.usersDoc);
  renderUsers();
  toast("Удалено", "ok");
}

$("#btn-user-add").addEventListener("click", () => openUserModal());
$("#um-cancel").addEventListener("click", () => $("#user-modal").classList.remove("show"));
$("#um-close").addEventListener("click", () => $("#user-modal").classList.remove("show"));
$("#um-role").addEventListener("change", toggleSkillModeUi);
$$('input[name="skill-mode"]').forEach(r => r.addEventListener("change", onSkillModeChange));

$("#um-skills-clear").addEventListener("click", () => {
  state.draftSkills = [];
  renderDraftSkillsTable();
});

$("#um-groups-clear").addEventListener("click", () => {
  state.draftAgentGroupIds.clear();
  renderAgentGroupsTable();
});

$("#um-groups-select").addEventListener("click", () => {
  state.pickSelection = new Set(state.draftAgentGroupIds);
  renderAgentGroupPicker();
  $("#agent-group-pick-modal").classList.add("show");
});

function renderAgentGroupPicker() {
  const filter = ($("#agent-group-pick-filter").value || "").toLowerCase();
  const host = $("#agent-group-pick-list");
  host.innerHTML = "";
  for (const g of skillGroupsAssignable()) {
    if (filter && !g.name.toLowerCase().includes(filter) && !groupDetailsText(g).toLowerCase().includes(filter)) {
      continue;
    }
    const row = document.createElement("label");
    row.className = "skill-pick-item";
    const details = groupDetailsText(g);
    row.innerHTML = `<input type="checkbox" value="${g.id}" ${state.pickSelection.has(g.id) ? "checked" : ""} />
      <span>${g.name}<span class="agent-group-pick-meta"> — ${details}</span></span>`;
    row.querySelector("input").addEventListener("change", e => {
      if (e.target.checked) state.pickSelection.add(g.id);
      else state.pickSelection.delete(g.id);
    });
    host.appendChild(row);
  }
}

$("#agent-group-pick-filter").addEventListener("input", renderAgentGroupPicker);
$("#agent-group-pick-cancel").addEventListener("click", () => $("#agent-group-pick-modal").classList.remove("show"));
$("#agent-group-pick-ok").addEventListener("click", () => {
  state.draftAgentGroupIds = new Set(state.pickSelection);
  renderAgentGroupsTable();
  $("#agent-group-pick-modal").classList.remove("show");
});

function openSkillQueuePicker(target, initialQueues) {
  state.pickerTarget = target;
  state.pickSelection = new Set(initialQueues);
  $("#skill-pick-title").textContent = "Skill Queue List";
  renderSkillPicker();
  $("#skill-pick-modal").classList.add("show");
}

$("#um-skills-select").addEventListener("click", () => {
  openSkillQueuePicker("agent-skill", state.draftSkills.map(s => s.queue || s.name));
});

function renderSkillPicker() {
  const filter = ($("#skill-pick-filter").value || "").toLowerCase();
  const host = $("#skill-pick-list");
  host.innerHTML = "";
  for (const opt of allSkillOptions()) {
    if (filter && !opt.name.toLowerCase().includes(filter) && !opt.queue.includes(filter)) continue;
    const key = opt.queue || opt.name;
    const row = document.createElement("label");
    row.className = "skill-pick-item";
    row.innerHTML = `<input type="checkbox" value="${key}" data-id="${opt.skill_id ?? ""}" data-name="${opt.name}" ${state.pickSelection.has(key) ? "checked" : ""} /> ${opt.name}`;
    row.querySelector("input").addEventListener("change", e => {
      if (e.target.checked) state.pickSelection.add(key);
      else state.pickSelection.delete(key);
    });
    host.appendChild(row);
  }
}

$("#skill-pick-filter").addEventListener("input", renderSkillPicker);
$("#skill-pick-cancel").addEventListener("click", () => $("#skill-pick-modal").classList.remove("show"));
$("#skill-pick-ok").addEventListener("click", () => {
  const selected = [...state.pickSelection];
  if (state.pickerTarget === "group-queues") {
    state.draftGroupQueues = selected;
    renderGroupQueuesTable();
  } else {
    const next = [];
    for (const cb of $$("#skill-pick-list input:checked")) {
      const queue = cb.value;
      const existing = state.draftSkills.find(s => (s.queue || s.name) === queue);
      next.push(existing || {
        skill_id: cb.dataset.id ? parseInt(cb.dataset.id, 10) : null,
        queue,
        name: cb.dataset.name || queue,
        agent_rating: 1,
        skill_rating: 1,
        penalty: 0,
      });
    }
    state.draftSkills = next;
    renderDraftSkillsTable();
  }
  $("#skill-pick-modal").classList.remove("show");
});

$("#um-save").addEventListener("click", async () => {
  const login = $("#um-login").value.trim();
  if (!login) { toast("Укажите Agent ID / логин", "warn"); return; }
  const pass = $("#um-password").value;
  const pass2 = $("#um-password2").value;
  if (pass && pass !== pass2) { toast("Пароли не совпадают", "warn"); return; }

  const role = $("#um-role").value;
  const payload = {
    login,
    full_name: $("#um-name").value.trim(),
    role,
    sip_user: $("#um-sip").value.trim() || null,
    sip_password: $("#um-sippass").value || undefined,
    status: $("#um-status").value,
  };
  if (pass) payload.password = pass;

  if (role === "agent") {
    const skillMode = getSkillMode();
    payload.skill_mode = skillMode;
    if (skillMode === "by_group") {
      payload.groups = selectedGroupIds();
      payload.pick_skills = $("#um-pick-skills").checked;
      payload.assigned_skills = [];
      delete payload.assigned_skill_ids;
    } else {
      payload.groups = selectedGroupIds();
      payload.pick_skills = false;
      payload.assigned_skills = state.draftSkills.map(s => ({
        skill_id: s.skill_id ?? null,
        queue: s.queue || s.name,
        name: s.name || s.queue,
        agent_rating: s.agent_rating ?? 1,
        skill_rating: s.skill_rating ?? 1,
        penalty: s.penalty ?? 0,
      }));
      payload.assigned_skill_ids = payload.assigned_skills
        .map(s => s.skill_id)
        .filter(id => id != null);
    }
  } else {
    delete payload.skill_mode;
    delete payload.assigned_skills;
    payload.groups = selectedGroupIds().length ? selectedGroupIds() : [];
  }

  const users = state.usersDoc.users || [];
  if (state.editingUserId) {
    const u = users.find(x => x.id === state.editingUserId);
    if (!u) return;
    Object.assign(u, payload);
    if (!payload.sip_password) delete u.sip_password;
    else u.sip_password = payload.sip_password;
  } else {
    const maxId = users.reduce((m, u) => Math.max(m, u.id || 0), 0);
    users.push({
      id: maxId + 1,
      password: pass || "changeme",
      groups: role === "agent" ? (payload.groups || []) : [],
      ...payload,
    });
  }
  await persist(saveUsersOverride, state.usersDoc);
  $("#user-modal").classList.remove("show");
  renderUsers();
});

$("#user-filter").addEventListener("input", renderUsers);

// ---- Roles ----
const ALL_PERMS = [
  "*", "workspace.view", "history.view", "kb.view", "breaks.view", "catalog.view",
  "dashboard.view", "agents.view", "queues.view", "recordings.listen", "recordings.download",
  "spy.listen", "spy.whisper", "spy.barge", "audit.view", "reports.view",
  "admin.users", "admin.roles", "admin.groups", "admin.queues",
];

function renderRoles() {
  const tbody = $("#roles-tbl tbody");
  tbody.innerHTML = "";
  for (const [key, def] of Object.entries(state.rolesDoc.roles || {})) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><span class="kbd">${key}</span></td><td>${def.label}</td><td>${def.permissions.length}</td>`;
    tr.addEventListener("click", () => showRoleDetail(key, def));
    tbody.appendChild(tr);
  }
  const first = Object.entries(state.rolesDoc.roles || {})[0];
  if (first) showRoleDetail(first[0], first[1]);
}

function showRoleDetail(key, def) {
  $("#role-title").textContent = `${def.label} (${key})`;
  const host = $("#role-perms");
  host.innerHTML = "";
  for (const p of ALL_PERMS) {
    const on = def.permissions.includes("*") || def.permissions.includes(p);
    const chip = document.createElement("span");
    chip.className = "perm-chip" + (on ? " on" : "");
    chip.textContent = p;
    host.appendChild(chip);
  }
}

// ---- Groups (CSP Skill Group) ----
function renderGroups() {
  const tbody = $("#groups-tbl tbody");
  tbody.innerHTML = "";
  for (const g of state.groupsDoc.groups || []) {
    if (g.default_role && g.default_role !== "agent" && !(g.queues?.length)) continue;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="kbd">${g.id}</span></td>
      <td>${g.name}</td>
      <td title="${groupDetailsText(g)}">${groupDetailsText(g)}</td>
      <td>${g.default_penalty ?? 0}</td>
      <td class="row" style="gap:4px">
        <button class="btn ghost" data-act="edit">✎</button>
        <button class="btn ghost" data-act="del">✕</button>
      </td>`;
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openGroupModal(g));
    tr.querySelector('[data-act="del"]').addEventListener("click", () => deleteGroup(g.id));
    tbody.appendChild(tr);
  }
}

function renderGroupQueuesTable() {
  const tbody = $("#gm-queues-tbl tbody");
  tbody.innerHTML = "";
  state.draftGroupQueues.forEach((queue, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${queueDisplayName(queue)}</td>
      <td><button class="btn ghost" data-i="${i}">Delete</button></td>`;
    tr.querySelector("button").addEventListener("click", () => {
      state.draftGroupQueues.splice(i, 1);
      renderGroupQueuesTable();
    });
    tbody.appendChild(tr);
  });
}

function openGroupModal(g = null) {
  state.editingGroupId = g?.id ?? null;
  $("#group-modal-title").textContent = g ? `Change Skill Group — ${g.name}` : "Add Skill Group";
  $("#gm-id").value = g?.id || "";
  $("#gm-id").disabled = !!g;
  $("#gm-name").value = g?.name || "";
  $("#gm-desc").value = g?.description || "";
  $("#gm-penalty").value = g?.default_penalty ?? 0;
  state.draftGroupQueues = [...(g?.queues || [])];
  renderGroupQueuesTable();
  $("#group-modal").classList.add("show");
}

async function deleteGroup(id) {
  if (!confirm("Удалить skill group?")) return;
  state.groupsDoc.groups = (state.groupsDoc.groups || []).filter(g => g.id !== id);
  await persist(saveGroupsOverride, state.groupsDoc);
  renderGroups();
  toast("Группа удалена", "ok");
}

$("#btn-group-add").addEventListener("click", () => openGroupModal());
$("#gm-close").addEventListener("click", () => $("#group-modal").classList.remove("show"));
$("#gm-cancel").addEventListener("click", () => $("#group-modal").classList.remove("show"));
$("#gm-queues-clear").addEventListener("click", () => {
  state.draftGroupQueues = [];
  renderGroupQueuesTable();
});
$("#gm-queues-select").addEventListener("click", () => {
  openSkillQueuePicker("group-queues", state.draftGroupQueues);
});

$("#gm-save").addEventListener("click", async () => {
  const id = ($("#gm-id").value || "").trim().replace(/\s+/g, "_");
  const name = $("#gm-name").value.trim();
  if (!id || !name) { toast("Укажите ID и название группы", "warn"); return; }
  if (!state.draftGroupQueues.length) { toast("Добавьте хотя бы одно направление (Skill Queue)", "warn"); return; }

  const payload = {
    id,
    name,
    description: $("#gm-desc").value.trim(),
    default_role: "agent",
    queues: [...state.draftGroupQueues],
    default_penalty: parseInt($("#gm-penalty").value, 10) || 0,
  };

  const groups = state.groupsDoc.groups || [];
  if (state.editingGroupId) {
    const g = groups.find(x => x.id === state.editingGroupId);
    if (g) Object.assign(g, payload);
  } else {
    if (groups.some(x => x.id === id)) { toast("ID уже существует", "warn"); return; }
    groups.push(payload);
  }
  await persist(saveGroupsOverride, state.groupsDoc);
  $("#group-modal").classList.remove("show");
  renderGroups();
  toast("Skill Group сохранена", "ok");
});

// ---- Export / import ----
function downloadJson(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

$("#btn-users-export").addEventListener("click", () => downloadJson("users.json", state.usersDoc));
$("#btn-groups-export").addEventListener("click", () => downloadJson("groups.json", state.groupsDoc));
$("#btn-export-all").addEventListener("click", () => {
  downloadJson("users.json", state.usersDoc);
  downloadJson("groups.json", state.groupsDoc);
  downloadJson("roles.json", state.rolesDoc);
});

$("#btn-users-import").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  state.usersDoc = JSON.parse(await f.text());
  await persist(saveUsersOverride, state.usersDoc);
  renderUsers();
  toast("users.json импортирован", "ok");
});

$("#btn-groups-import").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  state.groupsDoc = JSON.parse(await f.text());
  await persist(saveGroupsOverride, state.groupsDoc);
  renderGroups();
  toast("groups.json импортирован", "ok");
});

$("#btn-apply-asterisk")?.addEventListener("click", async () => {
  try {
    const res = await apiPost("/admin/apply-asterisk", {});
    const extra = formatAsteriskSyncToast(res);
    toast(extra || "Синхронизация выполнена", res?.ok === false ? "err" : "ok", 5000);
  } catch (e) {
    toast(e.message || "Ошибка синхронизации", "err");
  }
});

$("#btn-reset-demo").addEventListener("click", async () => {
  if (!confirm("Перезагрузить все справочники из JSON-файлов в Postgres?")) return;
  try {
    const res = await apiPost("/admin/seed", {});
    toast("Данные загружены в БД", "ok");
    const extra = formatAsteriskSyncToast(res?.asterisk_sync);
    if (extra) toast(extra, res?.asterisk_sync?.ok === false ? "err" : "ok", 5000);
    setTimeout(() => location.reload(), 1500);
  } catch (e) {
    toast(e.message || "Ошибка seed", "err");
  }
});

// ---- VDN / Short numbers ----
const ROUTE_TYPE_LABELS = {
  queue_direct: "Сразу в очередь",
  ivr_language: "IVR → язык → очередь",
};

function skillQueueById(id) {
  return (state.skillQueuesDoc?.skill_queues || []).find(s => s.id === id);
}

function fillSkillQueueSelect(sel, selectedId = null, selectedQueue = null) {
  sel.innerHTML = '<option value="">— выберите —</option>';
  for (const s of state.skillQueuesDoc?.skill_queues || []) {
    const opt = document.createElement("option");
    opt.value = String(s.id);
    opt.textContent = `${s.name} (${s.queue})`;
    opt.dataset.queue = s.queue;
    if (selectedId === s.id || (selectedQueue && s.queue === selectedQueue)) opt.selected = true;
    sel.appendChild(opt);
  }
}

function vdnDestinationSummary(r) {
  if (r.route_type === "queue_direct") {
    const sk = skillQueueById(r.skill_queue_id);
    return sk ? `${sk.name} → ${sk.queue}` : (r.queue || "—");
  }
  if (r.route_type === "ivr_language" && r.language_options?.length) {
    return r.language_options.map(o => `${o.digit}:${o.label || o.lang}→${o.queue}`).join("; ");
  }
  return "—";
}

function renderVdnTable() {
  const tbody = $("#vdn-tbl tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const r of state.vdnDoc?.routes || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="kbd">${r.number}</span></td>
      <td>${r.name || "—"}</td>
      <td>${ROUTE_TYPE_LABELS[r.route_type] || r.route_type}</td>
      <td>${vdnDestinationSummary(r)}</td>
      <td>${r.enabled !== false ? '<span class="tag ok">on</span>' : '<span class="tag">off</span>'}</td>
      <td class="row" style="gap:4px">
        <button class="btn ghost" data-act="edit">✎</button>
        <button class="btn ghost" data-act="del">✕</button>
      </td>`;
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openVdnModal(r));
    tr.querySelector('[data-act="del"]').addEventListener("click", () => deleteVdn(r.id));
    tbody.appendChild(tr);
  }
}

function toggleVdnRouteTypeUi() {
  const t = $("#vm-route-type").value;
  $("#vm-queue-block").hidden = t !== "queue_direct";
  $("#vm-ivr-block").hidden = t !== "ivr_language";
}

function renderLangOptionsTable() {
  const tbody = $("#vm-lang-tbl tbody");
  tbody.innerHTML = "";
  fillSkillQueueSelect($("#vm-skill-queue")); // keep main select fresh
  state.draftLangOptions.forEach((row, i) => {
    const tr = document.createElement("tr");
    const sqOpts = (state.skillQueuesDoc?.skill_queues || []).map(s => {
      const sel = (row.skill_queue_id === s.id || row.queue === s.queue) ? "selected" : "";
      return `<option value="${s.id}" data-queue="${s.queue}" ${sel}>${s.name}</option>`;
    }).join("");
    tr.innerHTML = `
      <td><input type="text" maxlength="1" value="${row.digit || ""}" data-i="${i}" data-f="digit" style="width:48px" /></td>
      <td><input type="text" value="${row.lang || ""}" data-i="${i}" data-f="lang" placeholder="ru" /></td>
      <td><input type="text" value="${row.label || ""}" data-i="${i}" data-f="label" /></td>
      <td><select data-i="${i}" data-f="skill"><option value="">—</option>${sqOpts}</select></td>
      <td><button class="btn ghost" data-del="${i}">✕</button></td>`;
    tr.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("change", e => {
        const idx = parseInt(e.target.dataset.i, 10);
        state.draftLangOptions[idx][e.target.dataset.f] = e.target.value.trim();
      });
    });
    tr.querySelector("select").addEventListener("change", e => {
      const idx = parseInt(e.target.dataset.i, 10);
      const opt = e.target.selectedOptions[0];
      state.draftLangOptions[idx].skill_queue_id = parseInt(opt.value, 10) || null;
      state.draftLangOptions[idx].queue = opt.dataset.queue || "";
    });
    tr.querySelector("[data-del]").addEventListener("click", () => {
      state.draftLangOptions.splice(i, 1);
      renderLangOptionsTable();
    });
    tbody.appendChild(tr);
  });
}

function openVdnModal(r = null) {
  state.editingVdnId = r?.id ?? null;
  $("#vdn-modal-title").textContent = r ? `VDN — ${r.number}` : "Добавить короткий номер";
  $("#vm-number").value = r?.number || "";
  $("#vm-name").value = r?.name || "";
  $("#vm-desc").value = r?.description || "";
  $("#vm-route-type").value = r?.route_type || "queue_direct";
  $("#vm-enabled").value = r?.enabled === false ? "0" : "1";
  fillSkillQueueSelect($("#vm-skill-queue"), r?.skill_queue_id ?? null, r?.queue);
  state.draftLangOptions = (r?.language_options || []).map(o => ({ ...o }));
  if (!state.draftLangOptions.length && r?.route_type === "ivr_language") {
    state.draftLangOptions = [
      { digit: "1", lang: "ru", label: "Русский", queue: "russkaya", skill_queue_id: 8 },
      { digit: "2", lang: "tj", label: "Тоҷикӣ", queue: "tajikskaya", skill_queue_id: 7 },
    ];
  }
  toggleVdnRouteTypeUi();
  renderLangOptionsTable();
  $("#vdn-modal").classList.add("show");
}

async function deleteVdn(id) {
  if (!confirm("Удалить короткий номер?")) return;
  state.vdnDoc.routes = (state.vdnDoc.routes || []).filter(r => r.id !== id);
  await persist(saveVdnRoutesOverride, state.vdnDoc);
  renderVdnTable();
  toast("VDN удалён", "ok");
}

function nextVdnId() {
  return (state.vdnDoc?.routes || []).reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
}

$("#btn-vdn-add").addEventListener("click", () => openVdnModal());
$("#vm-close").addEventListener("click", () => $("#vdn-modal").classList.remove("show"));
$("#vm-cancel").addEventListener("click", () => $("#vdn-modal").classList.remove("show"));
$("#vm-route-type").addEventListener("change", toggleVdnRouteTypeUi);
$("#vm-lang-add").addEventListener("click", () => {
  const n = state.draftLangOptions.length + 1;
  state.draftLangOptions.push({ digit: String(n), lang: "", label: "", queue: "", skill_queue_id: null });
  renderLangOptionsTable();
});

$("#vm-save").addEventListener("click", async () => {
  const number = $("#vm-number").value.trim().replace(/\D/g, "");
  const name = $("#vm-name").value.trim();
  const routeType = $("#vm-route-type").value;
  if (!number || !name) { toast("Укажите номер и название", "warn"); return; }

  const payload = {
    number,
    name,
    description: $("#vm-desc").value.trim(),
    route_type: routeType,
    enabled: $("#vm-enabled").value === "1",
    language_options: [],
  };

  if (routeType === "queue_direct") {
    const sel = $("#vm-skill-queue");
    const opt = sel.selectedOptions[0];
    if (!opt?.value) { toast("Выберите Skill Queue", "warn"); return; }
    payload.skill_queue_id = parseInt(opt.value, 10);
    payload.queue = opt.dataset.queue || "";
  } else {
    if (!state.draftLangOptions.length) { toast("Добавьте хотя бы одну клавишу IVR", "warn"); return; }
    payload.language_options = state.draftLangOptions.map(o => ({
      digit: String(o.digit || "").replace(/\D/g, "").slice(0, 1),
      lang: o.lang || "",
      label: o.label || "",
      queue: o.queue || "",
      skill_queue_id: o.skill_queue_id ?? null,
    })).filter(o => o.digit && o.queue);
    if (!payload.language_options.length) { toast("Заполните клавиши и Skill Queue", "warn"); return; }
  }

  const routes = state.vdnDoc.routes || [];
  if (state.editingVdnId) {
    const r = routes.find(x => x.id === state.editingVdnId);
    if (r) Object.assign(r, { ...payload, id: r.id });
  } else {
    if (routes.some(x => x.number === number)) { toast("Такой номер уже есть", "warn"); return; }
    routes.push({ id: nextVdnId(), ...payload });
  }
  state.vdnDoc.routes = routes;
  await persist(saveVdnRoutesOverride, state.vdnDoc);
  $("#vdn-modal").classList.remove("show");
  renderVdnTable();
  toast("VDN сохранён", "ok");
});

$("#btn-vdn-export").addEventListener("click", () => downloadJson("vdn_routes.json", state.vdnDoc));
$("#btn-vdn-import").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  state.vdnDoc = JSON.parse(await f.text());
  await persist(saveVdnRoutesOverride, state.vdnDoc);
  renderVdnTable();
  toast("vdn_routes.json импортирован", "ok");
});

// ---- Subscribers ЧС / VIP ----
function subPeriodLabel(e) {
  if (e.permanent) return "Бессрочно";
  const a = e.valid_from || "—";
  const b = e.valid_until || "—";
  return `${a} … ${b}`;
}

function subTargetsLabel(e) {
  if (e.scope === "all" || !e.scope) return "—";
  const parts = [];
  for (const gid of e.group_ids || []) {
    const g = (state.groupsDoc?.groups || []).find(x => x.id === gid);
    parts.push(g ? g.name : gid);
  }
  for (const q of e.queues || []) parts.push(queueDisplayName(q));
  return parts.length ? parts.join(", ") : "—";
}

function subStatusTag(e) {
  if (e.enabled === false) return '<span class="tag">off</span>';
  if (!isEntryActive(e)) return '<span class="tag">истёк</span>';
  return '<span class="tag ok">on</span>';
}

function filteredSubscribers() {
  const typeF = $("#sub-filter-type")?.value || "";
  const msisdnF = normalizeMsisdn($("#sub-filter-msisdn")?.value || "");
  return (state.subscribersDoc?.entries || []).filter(e => {
    if (typeF && e.list_type !== typeF) return false;
    if (msisdnF && !normalizeMsisdn(e.msisdn).includes(msisdnF)) return false;
    return true;
  });
}

function renderSubscribersTable() {
  const tbody = $("#sub-tbl tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const e of filteredSubscribers()) {
    const typeCls = e.list_type === "vip" ? "vip" : "bl";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="kbd">${e.msisdn}</span></td>
      <td><span class="tag ${typeCls}">${LIST_TYPE_LABELS[e.list_type] || e.list_type}</span></td>
      <td>${subPeriodLabel(e)}</td>
      <td>${SCOPE_LABELS[e.scope] || e.scope}</td>
      <td>${subTargetsLabel(e)}</td>
      <td>${e.reason || "—"}</td>
      <td>${subStatusTag(e)}</td>
      <td class="row" style="gap:4px">
        <button class="btn ghost" data-act="edit">✎</button>
        <button class="btn ghost" data-act="del">✕</button>
      </td>`;
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openSubModal(e));
    tr.querySelector('[data-act="del"]').addEventListener("click", () => deleteSubEntry(e.id));
    tbody.appendChild(tr);
  }
}

function renderSubScopePickers() {
  const scope = $("#sm-scope").value;
  $("#sm-scope-block").hidden = scope !== "selected";
  const gList = $("#sm-groups-list");
  const qList = $("#sm-queues-list");
  gList.innerHTML = "";
  qList.innerHTML = "";
  for (const g of skillGroupsAssignable()) {
    const id = `sm-g-${g.id}`;
    const lab = document.createElement("label");
    lab.innerHTML = `<input type="checkbox" id="${id}" ${state.draftSubGroups.has(g.id) ? "checked" : ""} /> ${g.name}`;
    lab.querySelector("input").addEventListener("change", ev => {
      if (ev.target.checked) state.draftSubGroups.add(g.id);
      else state.draftSubGroups.delete(g.id);
    });
    gList.appendChild(lab);
  }
  const queues = new Set();
  for (const s of state.skillQueuesDoc?.skill_queues || []) {
    if (s.queue) queues.add(s.queue);
  }
  for (const q of [...queues].sort()) {
    const id = `sm-q-${q}`;
    const lab = document.createElement("label");
    lab.innerHTML = `<input type="checkbox" id="${id}" ${state.draftSubQueues.has(q) ? "checked" : ""} /> ${queueDisplayName(q)} (${q})`;
    lab.querySelector("input").addEventListener("change", ev => {
      if (ev.target.checked) state.draftSubQueues.add(q);
      else state.draftSubQueues.delete(q);
    });
    qList.appendChild(lab);
  }
}

function toggleSubPeriodUi() {
  const perm = $("#sm-permanent").value === "1";
  $("#sm-valid-from").disabled = perm;
  $("#sm-valid-until").disabled = perm;
}

function openSubModal(e = null) {
  state.editingSubId = e?.id ?? null;
  $("#sub-modal-title").textContent = e ? `${LIST_TYPE_LABELS[e.list_type]} — ${e.msisdn}` : "Добавить абонента";
  $("#sm-msisdn").value = e?.msisdn || "";
  $("#sm-list-type").value = e?.list_type || "blacklist";
  $("#sm-scope").value = e?.scope || "all";
  $("#sm-permanent").value = e?.permanent !== false ? "1" : "0";
  $("#sm-valid-from").value = e?.valid_from || "";
  $("#sm-valid-until").value = e?.valid_until || "";
  $("#sm-reason").value = e?.reason || "";
  $("#sm-enabled").value = e?.enabled === false ? "0" : "1";
  state.draftSubGroups = new Set(e?.group_ids || []);
  state.draftSubQueues = new Set(e?.queues || []);
  toggleSubPeriodUi();
  renderSubScopePickers();
  $("#sub-modal").classList.add("show");
}

async function deleteSubEntry(id) {
  if (!confirm("Удалить запись?")) return;
  state.subscribersDoc.entries = (state.subscribersDoc.entries || []).filter(x => x.id !== id);
  await persist(saveSubscribersAccessOverride, state.subscribersDoc);
  renderSubscribersTable();
  toast("Запись удалена", "ok");
}

function nextSubId() {
  return (state.subscribersDoc?.entries || []).reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;
}

$("#btn-sub-add")?.addEventListener("click", () => openSubModal());
$("#sm-close")?.addEventListener("click", () => $("#sub-modal").classList.remove("show"));
$("#sm-cancel")?.addEventListener("click", () => $("#sub-modal").classList.remove("show"));
$("#sm-scope")?.addEventListener("change", renderSubScopePickers);
$("#sm-permanent")?.addEventListener("change", toggleSubPeriodUi);
$("#sub-filter-type")?.addEventListener("change", renderSubscribersTable);
$("#sub-filter-msisdn")?.addEventListener("input", renderSubscribersTable);

$("#sm-save")?.addEventListener("click", async () => {
  const msisdn = normalizeMsisdn($("#sm-msisdn").value.trim());
  const listType = $("#sm-list-type").value;
  const scope = $("#sm-scope").value;
  const permanent = $("#sm-permanent").value === "1";
  if (!msisdn) { toast("Укажите MSISDN", "warn"); return; }
  if (scope === "selected" && !state.draftSubGroups.size && !state.draftSubQueues.size) {
    toast("Выберите хотя бы одну группу или очередь", "warn");
    return;
  }
  if (!permanent && (!$("#sm-valid-from").value || !$("#sm-valid-until").value)) {
    toast("Укажите период действия", "warn");
    return;
  }

  const payload = {
    msisdn,
    list_type: listType,
    scope,
    queues: scope === "selected" ? [...state.draftSubQueues] : [],
    group_ids: scope === "selected" ? [...state.draftSubGroups] : [],
    permanent,
    valid_from: permanent ? null : $("#sm-valid-from").value,
    valid_until: permanent ? null : $("#sm-valid-until").value,
    reason: $("#sm-reason").value.trim(),
    enabled: $("#sm-enabled").value === "1",
    created_at: new Date().toISOString().slice(0, 10),
  };

  const entries = state.subscribersDoc.entries || [];
  const dup = entries.find(
    x => x.id !== state.editingSubId
      && normalizeMsisdn(x.msisdn) === msisdn
      && x.list_type === listType
  );
  if (dup) { toast("Такой MSISDN уже есть в этом списке", "warn"); return; }

  if (state.editingSubId) {
    const hit = entries.find(x => x.id === state.editingSubId);
    if (hit) Object.assign(hit, { ...payload, id: hit.id, created_at: hit.created_at || payload.created_at });
  } else {
    entries.push({ id: nextSubId(), ...payload });
  }
  state.subscribersDoc.entries = entries;
  await persist(saveSubscribersAccessOverride, state.subscribersDoc);
  $("#sub-modal").classList.remove("show");
  renderSubscribersTable();
  toast("Сохранено", "ok");
});

$("#btn-sub-export")?.addEventListener("click", () => downloadJson("subscribers_access.json", state.subscribersDoc));
$("#btn-sub-import")?.addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  state.subscribersDoc = JSON.parse(await f.text());
  await persist(saveSubscribersAccessOverride, state.subscribersDoc);
  renderSubscribersTable();
  toast("subscribers_access.json импортирован", "ok");
});

// ---- CRM connectors ----
const DEFAULT_CRM_MAPPING = {
  msisdn: "msisdn",
  name: "fullName",
  tariff: "tariffPlan",
  balance: "balance",
  category: "category",
  segment: "segment",
};

function renderCrmTable() {
  const tbody = $("#crm-tbl tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for (const c of state.crmDoc?.connectors || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.id ?? "—"}</td>
      <td>${c.name}</td>
      <td>${(c.connector_type || "rest").toUpperCase()}</td>
      <td>${c.is_default ? "да" : ""}</td>
      <td>${c.enabled ? "да" : "нет"}</td>
      <td>${c.description || ""}</td>
      <td class="row" style="gap:6px">
        <button class="btn ghost" data-crm-edit="${c.id}">Изменить</button>
        <button class="btn ghost" data-crm-del="${c.id}">Удалить</button>
      </td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("[data-crm-edit]").forEach(btn => {
    btn.addEventListener("click", () => openCrmModal(parseInt(btn.dataset.crmEdit, 10)));
  });
  tbody.querySelectorAll("[data-crm-del]").forEach(btn => {
    btn.addEventListener("click", () => deleteCrmConnector(parseInt(btn.dataset.crmDel, 10)));
  });
}

async function deleteCrmConnector(id) {
  const c = (state.crmDoc?.connectors || []).find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Удалить коннектор «${c.name}» из БД?`)) return;
  const left = (state.crmDoc?.connectors || []).filter(x => x.id !== id);
  if (!left.length) {
    toast("Нельзя удалить последний коннектор", "warn");
    return;
  }
  if (c.is_default) {
    left[0].is_default = true;
  }
  state.crmDoc = { version: 1, connectors: left };
  await persist(saveCrmConnectorsDoc, state.crmDoc, "Коннектор удалён");
  state.crmDoc = await loadCrmConnectors();
  renderCrmTable();
}

function crmToggleBlocks() {
  const t = $("#crm-type").value;
  $("#crm-rest-block").hidden = t !== "rest";
  $("#crm-soap-block").hidden = t !== "soap";
}

function openCrmModal(id = null) {
  state.editingCrmId = id;
  const c = id
    ? (state.crmDoc?.connectors || []).find(x => x.id === id)
    : {
        name: "Новый CRM",
        connector_type: "rest",
        enabled: false,
        is_default: !(state.crmDoc?.connectors || []).length,
        config: { method: "GET", url: "", auth: { type: "none" } },
        field_mapping: { ...DEFAULT_CRM_MAPPING },
        description: "",
      };
  $("#crm-modal-title").textContent = id ? `CRM #${id}` : "Новый коннектор";
  $("#crm-name").value = c.name || "";
  $("#crm-type").value = c.connector_type || "rest";
  $("#crm-enabled").checked = !!c.enabled;
  $("#crm-default").checked = !!c.is_default;
  $("#crm-desc").value = c.description || "";
  const cfg = c.config || {};
  $("#crm-url").value = cfg.url || cfg.endpoint || "";
  $("#crm-method").value = (cfg.method || "GET").toUpperCase();
  $("#crm-wsdl").value = cfg.wsdl_url || cfg.wsdl || "";
  $("#crm-params").value = JSON.stringify(cfg.parameters || { msisdn: "{{msisdn}}" }, null, 2);
  const extra = { ...cfg };
  delete extra.url;
  delete extra.endpoint;
  delete extra.method;
  delete extra.wsdl_url;
  delete extra.wsdl;
  delete extra.operation;
  delete extra.parameters;
  $("#crm-config-json").value = JSON.stringify(extra, null, 2);
  $("#crm-mapping-json").value = JSON.stringify(c.field_mapping || DEFAULT_CRM_MAPPING, null, 2);
  $("#crm-test-result").textContent = "";
  crmToggleBlocks();
  const opSel = $("#crm-operation");
  opSel.innerHTML = "";
  if (cfg.operation) {
    const opt = document.createElement("option");
    opt.value = cfg.operation;
    opt.textContent = cfg.operation;
    opSel.appendChild(opt);
  }
  $("#crm-modal").classList.add("show");
}

function buildCrmPayloadFromForm() {
  const ctype = $("#crm-type").value;
  let extra = {};
  try {
    extra = JSON.parse($("#crm-config-json").value || "{}");
  } catch {
    throw new Error("Конфиг JSON некорректен");
  }
  let mapping = {};
  try {
    mapping = JSON.parse($("#crm-mapping-json").value || "{}");
  } catch {
    throw new Error("Маппинг JSON некорректен");
  }
  const config = { ...extra, auth: extra.auth || { type: "none" } };
  if (ctype === "rest") {
    config.method = $("#crm-method").value || "GET";
    config.url = $("#crm-url").value.trim();
  } else {
    config.wsdl_url = $("#crm-wsdl").value.trim();
    config.operation = $("#crm-operation").value || extra.operation;
    try {
      config.parameters = JSON.parse($("#crm-params").value || "{}");
    } catch {
      throw new Error("Параметры SOAP — некорректный JSON");
    }
  }
  return {
    id: state.editingCrmId || undefined,
    name: $("#crm-name").value.trim(),
    connector_type: ctype,
    enabled: $("#crm-enabled").checked,
    is_default: $("#crm-default").checked,
    description: $("#crm-desc").value.trim(),
    config,
    field_mapping: mapping,
  };
}

$("#btn-crm-add")?.addEventListener("click", () => openCrmModal(null));
$("#crm-type")?.addEventListener("change", crmToggleBlocks);
$("#crm-close")?.addEventListener("click", () => $("#crm-modal").classList.remove("show"));
$("#crm-cancel")?.addEventListener("click", () => $("#crm-modal").classList.remove("show"));

$("#crm-wsdl-parse")?.addEventListener("click", async () => {
  const url = $("#crm-wsdl").value.trim();
  if (!url) { toast("Укажите WSDL URL", "warn"); return; }
  try {
    const res = await apiGet(`/crm/wsdl-parse?url=${encodeURIComponent(url)}`);
    const sel = $("#crm-operation");
    sel.innerHTML = "";
    for (const op of res.operations || []) {
      const opt = document.createElement("option");
      opt.value = op;
      opt.textContent = op;
      sel.appendChild(opt);
    }
    toast(`Операций: ${(res.operations || []).length}`, "ok");
  } catch (e) {
    toast(e.message || "WSDL error", "err");
  }
});

$("#crm-test-btn")?.addEventListener("click", async () => {
  const msisdn = $("#crm-test-msisdn").value.trim();
  if (!msisdn) { toast("MSISDN для теста", "warn"); return; }
  if (!state.editingCrmId) { toast("Сначала сохраните коннектор", "warn"); return; }
  try {
    const res = await apiPost("/crm/test", { connector_id: state.editingCrmId, msisdn });
    $("#crm-test-result").textContent = JSON.stringify(res, null, 2);
    toast(res.ok ? `OK ${res.ms}ms` : res.error || "Ошибка", res.ok ? "ok" : "err");
  } catch (e) {
    $("#crm-test-result").textContent = e.message;
    toast(e.message, "err");
  }
});

$("#crm-save")?.addEventListener("click", async () => {
  try {
    const payload = buildCrmPayloadFromForm();
    if (!payload.name) { toast("Название обязательно", "warn"); return; }
    const list = [...(state.crmDoc?.connectors || [])];
    if (payload.is_default) {
      for (const x of list) x.is_default = false;
    }
    const idx = list.findIndex(x => x.id === state.editingCrmId);
    if (idx >= 0) list[idx] = { ...list[idx], ...payload };
    else list.push(payload);
    state.crmDoc = { version: 1, connectors: list };
    await persist(saveCrmConnectorsDoc, state.crmDoc, "CRM сохранён");
    const saved = await loadCrmConnectors();
    state.crmDoc = saved;
    $("#crm-modal").classList.remove("show");
    renderCrmTable();
  } catch (e) {
    toast(e.message, "err");
  }
});

$("#btn-crm-export")?.addEventListener("click", () => downloadJson("crm_connectors.json", state.crmDoc));

boot();
