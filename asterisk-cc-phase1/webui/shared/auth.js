// Auth helpers: demo login against JSON, session in localStorage.
// Production: replace authenticate() with POST /api/auth/login.

const SESSION_KEY = "cc.session";
const USERS_OVERRIDE_KEY = "cc.users.override";
const GROUPS_OVERRIDE_KEY = "cc.groups.override";

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
    location.href = redirect;
    return null;
  }
  return s;
}

const DATA_BASE = new URL("../data/", import.meta.url);

async function loadJson(path) {
  const url = path instanceof URL ? path.href : path;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

export async function loadRoles() {
  return loadJson(new URL("roles.json", DATA_BASE));
}

export async function loadUsers() {
  const override = localStorage.getItem(USERS_OVERRIDE_KEY);
  if (override) {
    try {
      return JSON.parse(override);
    } catch { /* fall through */ }
  }
  return loadJson(new URL("users.json", DATA_BASE));
}

export async function loadGroups() {
  const override = localStorage.getItem(GROUPS_OVERRIDE_KEY);
  if (override) {
    try {
      return JSON.parse(override);
    } catch { /* fall through */ }
  }
  return loadJson(new URL("groups.json", DATA_BASE));
}

export function saveUsersOverride(data) {
  localStorage.setItem(USERS_OVERRIDE_KEY, JSON.stringify(data));
}

export function saveGroupsOverride(data) {
  localStorage.setItem(GROUPS_OVERRIDE_KEY, JSON.stringify(data));
}

export function clearUsersOverride() {
  localStorage.removeItem(USERS_OVERRIDE_KEY);
}

export function clearGroupsOverride() {
  localStorage.removeItem(GROUPS_OVERRIDE_KEY);
}

/** Resolve queue memberships + penalties from user groups. */
export function resolveQueueBindings(user, groupsDoc) {
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

/** Map queue names from groups to skill_queue IDs in catalog. */
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
  if (Array.isArray(user.assigned_skill_ids) && user.assigned_skill_ids.length) {
    return user.assigned_skill_ids;
  }
  const bindings = resolveQueueBindings(user, groupsDoc);
  return resolveSkillIdsFromQueues(bindings, catalog);
}

export async function authenticate(login, password) {
  const [usersDoc, rolesDoc, groupsDoc] = await Promise.all([
    loadUsers(),
    loadRoles(),
    loadGroups(),
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
    pickSkills: user.role === "agent" && user.pick_skills !== false,
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
