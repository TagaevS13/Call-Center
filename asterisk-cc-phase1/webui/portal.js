import { $, toast } from "./shared/common.js";
import {
  authenticate,
  getSession,
  setSession,
  homeForRole,
} from "./shared/auth.js";

async function tryRedirectExisting() {
  const s = getSession();
  if (!s) return;
  location.href = homeForRole(s.role);
}

// Снимаем readonly с пароля по фокусу — Chrome не предлагает «утёкший» пароль из менеджера.
const passEl = $("#password");
passEl.addEventListener("focus", () => { passEl.removeAttribute("readonly"); }, { once: true });
document.getElementById("login-form")?.addEventListener("submit", e => { e.preventDefault(); doLogin(); });
$("#btn-login").addEventListener("click", doLogin);
$("#password").addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin();
});
$("#login").addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin();
});

async function doLogin() {
  const login = $("#login").value.trim();
  const password = $("#password").value;
  $("#err").textContent = "";
  if (!login || !password) {
    $("#err").textContent = "Введите логин и пароль";
    return;
  }
  $("#btn-login").disabled = true;
  try {
    const result = await authenticate(login, password);
    if (!result.ok) {
      $("#err").textContent = result.error;
      return;
    }
    setSession(result.session);
    toast(`Добро пожаловать, ${result.session.fullName}`, "ok");
    location.href = homeForRole(result.session.role);
  } catch (err) {
    console.error("[auth]", err);
    $("#err").textContent = `Ошибка загрузки: ${err.message}. Откройте http://localhost:8765/ через serve.py`;
  } finally {
    $("#btn-login").disabled = false;
  }
}

tryRedirectExisting();
