/** REST client — Postgres via /api (source of truth). */

const API_ROOT = "/api";

export class ApiUnavailableError extends Error {
  constructor() {
    super("API_UNAVAILABLE");
    this.name = "ApiUnavailableError";
  }
}

export async function apiFetch(method, path, body) {
  const opts = { method, headers: {}, cache: "no-store" };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`${API_ROOT}${path}`, opts);
  if (r.status === 503) throw new ApiUnavailableError();
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${r.status}`);
  }
  if (r.status === 204) return null;
  return r.json();
}

export const apiGet = (path) => apiFetch("GET", path);
export const apiPut = (path, body) => apiFetch("PUT", path, body);
export const apiPost = (path, body) => apiFetch("POST", path, body);

export function formatAsteriskSyncToast(sync) {
  if (!sync) return null;
  if (sync.ok === false) return `Asterisk: ошибка — ${sync.error || "sync failed"}`;
  const q = sync.queues ?? "?";
  const v = sync.vdn_routes ?? "?";
  const p = sync.pjsip_agents ?? "?";
  return `Asterisk: очередей ${q}, VDN ${v}, SIP ${p} — reload запрошен`;
}

export async function apiHealth() {
  try {
    return await apiGet("/health");
  } catch {
    return { ok: false, db: false };
  }
}
