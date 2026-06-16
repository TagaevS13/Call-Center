/** ЧС / VIP: нормализация MSISDN и проверка правил (UI + AGI/REST). */

export function normalizeMsisdn(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 9 && /^9/.test(d)) d = "992" + d;
  return d;
}

export function isEntryActive(entry, now = new Date()) {
  if (!entry || entry.enabled === false) return false;
  if (entry.permanent) return true;
  const from = entry.valid_from ? new Date(`${entry.valid_from}T00:00:00`) : null;
  const until = entry.valid_until ? new Date(`${entry.valid_until}T23:59:59`) : null;
  if (from && now < from) return false;
  if (until && now > until) return false;
  return !!(entry.valid_from || entry.valid_until);
}

export function resolveEntryQueues(entry, groupsDoc) {
  const set = new Set((entry.queues || []).map(q => String(q).toLowerCase()));
  for (const gid of entry.group_ids || []) {
    const g = (groupsDoc?.groups || []).find(x => x.id === gid);
    for (const q of g?.queues || []) set.add(String(q).toLowerCase());
  }
  return [...set];
}

/** scope=all — на все направления; selected — только перечисленные очереди/группы. */
export function scopeMatches(entry, queueName, groupsDoc) {
  if (!entry || entry.scope === "all" || !entry.scope) return true;
  const q = String(queueName || "").toLowerCase();
  if (!q) return false;
  return resolveEntryQueues(entry, groupsDoc).includes(q);
}

export function entriesForMsisdn(doc, msisdn) {
  const norm = normalizeMsisdn(msisdn);
  return (doc?.entries || []).filter(
    e => normalizeMsisdn(e.msisdn) === norm && isEntryActive(e)
  );
}

/**
 * @returns {{ blocked: boolean, blockReason: string, vip: boolean, vipQueue: string }}
 */
export function checkSubscriberAccess(doc, msisdn, { queue = null, groupsDoc = null } = {}) {
  const active = entriesForMsisdn(doc, msisdn);
  let blocked = false;
  let blockReason = "";
  let vip = false;
  let vipQueue = "vip";

  for (const e of active) {
    if (e.list_type !== "blacklist") continue;
    if (!queue && e.scope === "selected") continue;
    if (e.scope === "all" || !e.scope || scopeMatches(e, queue, groupsDoc)) {
      blocked = true;
      blockReason = e.reason || "blacklist";
      break;
    }
  }

  if (blocked) return { blocked: true, blockReason, vip: false, vipQueue };

  for (const e of active) {
    if (e.list_type !== "vip") continue;
    if (queue && !scopeMatches(e, queue, groupsDoc)) continue;
    vip = true;
    const qs = resolveEntryQueues(e, groupsDoc);
    if (qs.length) vipQueue = qs[0];
    else if (e.queues?.[0]) vipQueue = e.queues[0];
    break;
  }

  return { blocked: false, blockReason: "", vip, vipQueue };
}

/** Для IVR: глобальный ЧС (scope=all) до выбора очереди. */
export function isGloballyBlacklisted(doc, msisdn) {
  const active = entriesForMsisdn(doc, msisdn);
  return active.some(
    e => e.list_type === "blacklist" && (e.scope === "all" || !e.scope)
  );
}

/** Для IVR: VIP с scope=all — сразу в VIP-очередь. */
export function getGlobalVipRoute(doc, msisdn, groupsDoc) {
  const active = entriesForMsisdn(doc, msisdn).filter(e => e.list_type === "vip");
  for (const e of active) {
    if (e.scope !== "all" && e.scope) continue;
    const qs = resolveEntryQueues(e, groupsDoc);
    return { vip: true, vipQueue: qs[0] || e.queues?.[0] || "vip" };
  }
  return { vip: false, vipQueue: "vip" };
}

export const LIST_TYPE_LABELS = {
  blacklist: "Чёрный список",
  vip: "VIP",
};

export const SCOPE_LABELS = {
  all: "Все направления",
  selected: "Выбранные группы/очереди",
};
