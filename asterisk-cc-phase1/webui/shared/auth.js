// Auth + admin data: Postgres REST API (/api). JSON files — fallback если API недоступен.

import { apiGet, apiPut, apiPost, ApiUnavailableError } from "./api.js";

const SESSION_KEY = "cc.session";
const DATA_BASE = new URL("../data/", import.meta.url);

export function getSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function hasPermission(session, perm) {
  if (!session?.permissions) return false;
  if (session.permissions.includes("*")) return true;
  return session.permissions.includes(perm);
}

export function requireSession({ roles, redirect = "../index.html" } = {}) {
  const s = getSession();
  if (!s) {
    location.href = redirect;
    return null;
  }
  if (roles?.length && !roles.includes(s.role)) {
    clearSession();
    const sep = redirect.includes("?") ? "&" : "?";
    location.href = `${redirect}${sep}relogin=1`;
    return null;
  }
  return s;
}

async function loadJson(path) {
  const url = path instanceof URL ? path.href : path;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function loadFromApi(path, jsonFile) {
  try {
    return await apiGet(path);
  } catch (e) {
    if (e instanceof ApiUnavailableError) {
      console.warn(`API offline, fallback ${jsonFile}`);
      return loadJson(new URL(jsonFile, DATA_BASE));
    }
    throw e;
  }
}

export async function loadRoles() {
  return loadFromApi("/admin/roles", "roles.json");
}

export async function loadUsers() {
  return loadFromApi("/admin/users", "users.json");
}

export async function loadGroups() {
  return loadFromApi("/admin/groups", "groups.json");
}

export async function loadSkillQueues() {
  return loadFromApi("/admin/skill-queues", "skill_queues.json");
}

export async function loadVdnRoutes() {
  return loadFromApi("/admin/vdn-routes", "vdn_routes.json");
}

export async function loadSubscribersAccess() {
  return loadFromApi("/admin/subscribers-access", "subscribers_access.json");
}

export async function loadCrmConnectors() {
  return loadFromApi("/admin/crm-connectors", "crm_connectors.json");
}

export async function saveUsersDoc(doc) {
  return apiPut("/admin/users", doc);
}

export async function saveGroupsDoc(doc) {
  return apiPut("/admin/groups", doc);
}

export async function saveSkillQueuesDoc(doc) {
  return apiPut("/admin/skill-queues", doc);
}

export async function saveVdnRoutesDoc(doc) {
  return apiPut("/admin/vdn-routes", doc);
}

export async function saveSubscribersAccessDoc(doc) {
  return apiPut("/admin/subscribers-access", doc);
}

export async function saveCrmConnectorsDoc(doc) {
  return apiPut("/admin/crm-connectors", doc);
}

/** @deprecated use save*Doc — kept for compatibility */
export const saveUsersOverride = saveUsersDoc;
export const saveGroupsOverride = saveGroupsDoc;
export const saveSkillQueuesOverride = saveSkillQueuesDoc;
export const saveVdnRoutesOverride = saveVdnRoutesDoc;
export const saveSubscribersAccessOverride = saveSubscribersAccessDoc;

export function clearUsersOverride() {}
export function clearGroupsOverride() {}
export function clearSkillQueuesOverride() {}
export function clearVdnRoutesOverride() {}
export function clearSubscribersAccessOverride() {}

export function resolveQueueBindings(user, groupsDoc) {
  if (user.role !== "agent") return [];

  if (user.skill_mode === "by_skill" && Array.isArray(user.assigned_skills) && user.assigned_skills.length) {
    const map = new Map();
    for (const sk of user.assigned_skills) {
      const queue = sk.queue || sk.name;
      if (!queue) continue;
      const penalty = sk.penalty ?? sk.agent_rating ?? 0;
      const prev = map.get(queue) ?? 0;
      map.set(queue, Math.max(prev, penalty));
    }
    return [...map.entries()].map(([queue, penalty]) => ({ queue, penalty }));
  }

  const map = new Map();
  const groupIds = user.groups || [];
  for (const gid of groupIds) {
    const g = (groupsDoc.groups || []).find(x => x.id === gid);
    if (!g?.queues) continue;
    for (const q of g.queues) {
      const prev = map.get(q) ?? 0;
      map.set(q, Math.max(prev, g.default_penalty ?? 0));
    }
  }
  return [...map.entries()].map(([queue, penalty]) => ({ queue, penalty }));
}

export function resolveSkillIdsFromQueues(queueBindings, catalog) {
  const skills = catalog?.skill_queues || [];
  const ids = [];
  for (const { queue } of queueBindings || []) {
    const q = (queue || "").toLowerCase();
    const sk = skills.find(s => (s.queue || s.name || "").toLowerCase() === q);
    if (sk && !ids.includes(sk.id)) ids.push(sk.id);
  }
  return ids;
}

export function resolveAssignedSkillIds(user, groupsDoc, catalog) {
  if (user.skill_mode === "by_skill" && Array.isArray(user.assigned_skills) && user.assigned_skills.length) {
    const skills = catalog?.skill_queues || [];
    const ids = [];
    for (const sk of user.assigned_skills) {
      if (sk.skill_id && !ids.includes(sk.skill_id)) {
        ids.push(sk.skill_id);
        continue;
      }
      const q = (sk.queue || sk.name || "").toLowerCase();
      const hit = skills.find(s => (s.queue || s.name || "").toLowerCase() === q);
      if (hit && !ids.includes(hit.id)) ids.push(hit.id);
    }
    if (ids.length) return ids;
  }
  if (Array.isArray(user.assigned_skill_ids) && user.assigned_skill_ids.length) {
    return user.assigned_skill_ids;
  }
  const bindings = resolveQueueBindings(user, groupsDoc);
  return resolveSkillIdsFromQueues(bindings, catalog);
}

export async function authenticate(login, password) {
  try {
    const res = await apiPost("/auth/login", { login, password });
    if (!res.ok) return { ok: false, error: res.error || "Ошибка входа" };
    const user = res.user;
    const [groupsDoc, rolesDoc] = await Promise.all([loadGroups(), loadRoles()]);
    const queueBindings = resolveQueueBindings(
      { ...user, role: user.role, skill_mode: user.skill_mode, assigned_skills: user.assigned_skills, groups: user.groups },
      groupsDoc
    );
    const session = {
      userId: user.id,
      login: user.login,
      fullName: user.full_name,
      role: user.role,
      roleLabel: user.role_label,
      permissions: user.permissions || [],
      groups: user.groups || [],
      sipUser: user.sip_user,
      sipPassword: user.sip_password,
      queueBindings,
      pickSkills: user.role === "agent" && user.skill_mode !== "by_skill" && user.pick_skills !== false,
      skillMode: user.skill_mode || "by_group",
      assignedSkills: user.assigned_skills || null,
      loggedInAt: new Date().toISOString(),
    };
    return { ok: true, session, usersDoc: null, rolesDoc, groupsDoc };
  } catch (e) {
    if (!(e instanceof ApiUnavailableError)) {
      return { ok: false, error: e.message };
    }
  }

  const [usersDoc, rolesDoc, groupsDoc] = await Promise.all([
    loadJson(new URL("users.json", DATA_BASE)),
    loadJson(new URL("roles.json", DATA_BASE)),
    loadJson(new URL("groups.json", DATA_BASE)),
  ]);

  const user = (usersDoc.users || []).find(
    u => u.login === login && u.password === password && u.status === "active"
  );
  if (!user) return { ok: false, error: "Неверный логин или пароль" };

  const roleDef = rolesDoc.roles?.[user.role];
  if (!roleDef) return { ok: false, error: "Роль не настроена" };

  const queueBindings = resolveQueueBindings(user, groupsDoc);

  const session = {
    userId: user.id,
    login: user.login,
    fullName: user.full_name,
    role: user.role,
    roleLabel: roleDef.label,
    permissions: roleDef.permissions || [],
    groups: user.groups || [],
    sipUser: user.sip_user,
    sipPassword: user.sip_password,
    queueBindings,
    pickSkills: user.role === "agent" && user.skill_mode !== "by_skill" && user.pick_skills !== false,
    skillMode: user.skill_mode || "by_group",
    assignedSkills: user.assigned_skills || null,
    assignedSkillIds: user.assigned_skill_ids || null,
    loggedInAt: new Date().toISOString(),
  };

  return { ok: true, session, usersDoc, rolesDoc, groupsDoc };
}

export function homeForRole(role) {
  switch (role) {
    case "admin": return "admin/";
    case "supervisor": return "supervisor/";
    case "qa":
    case "auditor": return "supervisor/";
    case "agent":
    default: return "agent/";
  }
}
