import { $, $$, toast } from "../shared/common.js";
import {
  requireSession,
  clearSession,
  loadUsers,
  loadGroups,
  loadRoles,
  saveUsersOverride,
  saveGroupsOverride,
  clearUsersOverride,
  clearGroupsOverride,
  resolveQueueBindings,
} from "../shared/auth.js";

const PRIO_KEY = "cc.priorities.override";

const state = {
  session: null,
  usersDoc: null,
  groupsDoc: null,
  rolesDoc: null,
  editingUserId: null,
  priorities: new Map(),
};

state.session = requireSession({ roles: ["admin"] });
if (!state.session) throw new Error("no session");

$("#who").textContent = `${state.session.fullName} (${state.session.role})`;

// ---- Tabs ----
function showTab(name) {
  $$(".panel").forEach(p => p.classList.toggle("active", p.dataset.panel === name));
  $$(".nav-item[data-tab]").forEach(n => n.classList.toggle("active", n.dataset.tab === name));
}
$$(".nav-item[data-tab]").forEach(n => n.addEventListener("click", () => showTab(n.dataset.tab)));

// ---- Theme / logout ----
$("#btn-theme").addEventListener("click", () => {
  const html = document.documentElement;
  html.dataset.theme = html.dataset.theme === "dark" ? "light" : "dark";
});
$("#btn-logout").addEventListener("click", () => {
  clearSession();
  location.href = "../index.html";
});

async function boot() {
  [state.usersDoc, state.groupsDoc, state.rolesDoc] = await Promise.all([
    loadUsers(),
    loadGroups(),
    loadRoles(),
  ]);
  loadPrioritiesFromStorage();
  renderUsers();
  renderRoles();
  renderGroups();
  renderPriorities();
}

function loadPrioritiesFromStorage() {
  state.priorities.clear();
  const raw = localStorage.getItem(PRIO_KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      for (const row of arr) state.priorities.set(`${row.login}|${row.queue}`, row.penalty);
    } catch { /* ignore */ }
  }
}

function savePrioritiesToStorage() {
  const arr = [];
  for (const [k, penalty] of state.priorities) {
    const [login, queue] = k.split("|");
    arr.push({ login, queue, penalty });
  }
  localStorage.setItem(PRIO_KEY, JSON.stringify(arr));
}

// ---- Users ----
function renderUsers() {
  const q = ($("#user-filter").value || "").toLowerCase();
  const tbody = $("#users-tbl tbody");
  tbody.innerHTML = "";
  for (const u of state.usersDoc.users || []) {
    if (q && !(u.login.toLowerCase().includes(q) || (u.full_name || "").toLowerCase().includes(q))) continue;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.id}</td>
      <td><span class="kbd">${u.login}</span></td>
      <td>${u.full_name || "—"}</td>
      <td><span class="badge-role">${u.role}</span></td>
      <td>${u.sip_user || "—"}</td>
      <td>${(u.groups || []).join(", ")}</td>
      <td>${u.role === "agent" ? (u.pick_skills !== false ? "сам" : "админ") : "—"}</td>
      <td>${u.status}</td>
      <td class="row" style="gap:4px">
        <button class="btn ghost" data-act="edit">✎</button>
        <button class="btn ghost" data-act="del">✕</button>
      </td>`;
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openUserModal(u));
    tr.querySelector('[data-act="del"]').addEventListener("click", () => deleteUser(u.id));
    tbody.appendChild(tr);
  }
}

function openUserModal(user = null) {
  state.editingUserId = user?.id ?? null;
  $("#user-modal-title").textContent = user ? `Редактировать: ${user.login}` : "Новый пользователь";
  $("#um-login").value = user?.login || "";
  $("#um-password").value = "";
  $("#um-name").value = user?.full_name || "";
  $("#um-role").value = user?.role || "agent";
  $("#um-sip").value = user?.sip_user || "";
  $("#um-sippass").value = user?.sip_password || "";
  $("#um-groups").value = (user?.groups || []).join(", ");
  $("#um-pick-skills").checked = user?.pick_skills !== false;
  $("#um-skill-ids").value = (user?.assigned_skill_ids || []).join(", ");
  $("#um-status").value = user?.status || "active";
  toggleSkillIdsField();
  $("#user-modal").classList.add("show");
}

function toggleSkillIdsField() {
  const on = $("#um-pick-skills").checked;
  $("#um-skill-ids").disabled = on;
  $("#um-skill-ids").placeholder = on
    ? "не нужно — оператор выберет сам"
    : "7, 9 или пусто = из групп";
}

$("#um-pick-skills")?.addEventListener("change", toggleSkillIdsField);

function deleteUser(id) {
  if (!confirm("Удалить пользователя?")) return;
  state.usersDoc.users = (state.usersDoc.users || []).filter(u => u.id !== id);
  saveUsersOverride(state.usersDoc);
  renderUsers();
  renderPriorities();
  toast("Пользователь удалён", "ok");
}

$("#btn-user-add").addEventListener("click", () => openUserModal());
$("#um-cancel").addEventListener("click", () => $("#user-modal").classList.remove("show"));
$("#um-save").addEventListener("click", () => {
  const login = $("#um-login").value.trim();
  if (!login) { toast("Укажите логин", "warn"); return; }
  const payload = {
    login,
    full_name: $("#um-name").value.trim(),
    role: $("#um-role").value,
    sip_user: $("#um-sip").value.trim() || null,
    sip_password: $("#um-sippass").value || undefined,
    groups: $("#um-groups").value.split(",").map(s => s.trim()).filter(Boolean),
    pick_skills: $("#um-pick-skills").checked,
    assigned_skill_ids: $("#um-skill-ids").value
      .split(",").map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n)),
    status: $("#um-status").value,
  };
  if (payload.role !== "agent") {
    delete payload.pick_skills;
    delete payload.assigned_skill_ids;
  }
  if (payload.pick_skills) payload.assigned_skill_ids = [];
  const pass = $("#um-password").value;
  if (pass) payload.password = pass;

  const users = state.usersDoc.users || [];
  if (state.editingUserId) {
    const u = users.find(x => x.id === state.editingUserId);
    if (!u) return;
    Object.assign(u, payload);
    if (!payload.sip_password) delete payload.sip_password;
    if (payload.sip_password) u.sip_password = payload.sip_password;
  } else {
    const maxId = users.reduce((m, u) => Math.max(m, u.id || 0), 0);
    users.push({
      id: maxId + 1,
      password: pass || "changeme",
      ...payload,
    });
  }
  saveUsersOverride(state.usersDoc);
  $("#user-modal").classList.remove("show");
  renderUsers();
  renderPriorities();
  toast("Сохранено (localStorage override)", "ok");
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

// ---- Groups ----
function renderGroups() {
  const tbody = $("#groups-tbl tbody");
  tbody.innerHTML = "";
  for (const g of state.groupsDoc.groups || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="kbd">${g.id}</span></td>
      <td>${g.name}</td>
      <td>${g.default_role || "—"}</td>
      <td>${(g.queues || []).join(", ") || "—"}</td>
      <td>${g.default_penalty ?? 0}</td>
      <td><button class="btn ghost" data-act="edit">✎</button></td>`;
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => editGroupPrompt(g));
    tbody.appendChild(tr);
  }
}

function editGroupPrompt(g) {
  const name = prompt("Название группы", g.name);
  if (name == null) return;
  const queues = prompt("Очереди (через запятую)", (g.queues || []).join(", "));
  if (queues == null) return;
  const penalty = prompt("Default penalty", String(g.default_penalty ?? 0));
  if (penalty == null) return;
  g.name = name;
  g.queues = queues.split(",").map(s => s.trim()).filter(Boolean);
  g.default_penalty = parseInt(penalty, 10) || 0;
  saveGroupsOverride(state.groupsDoc);
  renderGroups();
  renderPriorities();
  toast("Группа обновлена", "ok");
}

$("#btn-group-add").addEventListener("click", () => {
  const id = prompt("ID группы (латиница)", "new_group");
  if (!id) return;
  state.groupsDoc.groups.push({
    id,
    name: id,
    description: "",
    default_role: "agent",
    queues: [],
    default_penalty: 0,
  });
  saveGroupsOverride(state.groupsDoc);
  renderGroups();
  toast("Группа добавлена", "ok");
});

// ---- Priorities ----
function renderPriorities() {
  const tbody = $("#prio-tbl tbody");
  tbody.innerHTML = "";
  for (const u of state.usersDoc.users || []) {
    if (u.role !== "agent" || u.status !== "active") continue;
    const bindings = resolveQueueBindings(u, state.groupsDoc);
    for (const { queue, penalty } of bindings) {
      const key = `${u.login}|${queue}`;
      const override = state.priorities.has(key) ? state.priorities.get(key) : penalty;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${u.full_name} <span class="kbd">${u.login}</span></td>
        <td>${queue}</td>
        <td><input type="number" min="0" max="99" value="${override}" data-key="${key}" style="width:72px" /></td>
        <td>${state.priorities.has(key) ? "override" : "group"}</td>`;
      tr.querySelector("input").addEventListener("change", e => {
        state.priorities.set(key, parseInt(e.target.value, 10) || 0);
      });
      tbody.appendChild(tr);
    }
  }
}

$("#btn-prio-save").addEventListener("click", () => {
  savePrioritiesToStorage();
  toast("Приоритеты сохранены (демо)", "ok");
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
  saveUsersOverride(state.usersDoc);
  renderUsers();
  renderPriorities();
  toast("users.json импортирован", "ok");
});

$("#btn-groups-import").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  state.groupsDoc = JSON.parse(await f.text());
  saveGroupsOverride(state.groupsDoc);
  renderGroups();
  renderPriorities();
  toast("groups.json импортирован", "ok");
});

$("#btn-reset-demo").addEventListener("click", () => {
  if (!confirm("Сбросить все демо-override (users, groups, priorities)?")) return;
  clearUsersOverride();
  clearGroupsOverride();
  localStorage.removeItem(PRIO_KEY);
  location.reload();
});

boot();
