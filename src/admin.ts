import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccessAdminRepository, AdminSession } from "./access.js";
import { HttpError } from "./auth.js";
import { apiRoles, type ApiRole } from "./config.js";
import { assistantProfiles, type AssistantProfile } from "./profiles.js";

const sessionCookie = "chatbot_admin_session";
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function form(request: FastifyRequest): Record<string, unknown> {
  return typeof request.body === "object" && request.body !== null
    ? (request.body as Record<string, unknown>)
    : {};
}

function selectedValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return value === undefined ? [] : [String(value)];
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
  repository: AccessAdminRepository,
): Promise<AdminSession | null> {
  const token = request.cookies[sessionCookie];
  const session = token ? await repository.findSession(token) : null;
  if (!session) {
    await reply.redirect("/admin/login");
    return null;
  }
  return session;
}

function assertCsrf(request: FastifyRequest, session: AdminSession): void {
  const csrf = String(form(request).csrf ?? "");
  if (!csrf || !secureEqual(csrf, session.csrfToken)) {
    throw new HttpError(403, "INVALID_CSRF", "Невалиден CSRF токен.");
  }
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Leon Chatbot</title><style>
  :root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#14251f;background:#f3f7f5}*{box-sizing:border-box}body{margin:0}header{background:#123d31;color:#fff;padding:18px 4vw;display:flex;justify-content:space-between;align-items:center}main{max-width:1180px;margin:32px auto;padding:0 20px}h1,h2{margin-top:0}.card{background:#fff;border:1px solid #dce7e2;border-radius:14px;padding:22px;margin-bottom:22px;box-shadow:0 8px 25px #143c3010}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}label{display:block;font-weight:650;margin:10px 0 5px}input,select{width:100%;padding:10px;border:1px solid #b9cbc4;border-radius:8px}fieldset{border:0;padding:0;margin:12px 0}.check{display:inline-flex;gap:6px;align-items:center;margin:5px 12px 5px 0;font-weight:400}.check input{width:auto}button,.button{background:#1a6b51;color:#fff;border:0;border-radius:8px;padding:10px 15px;cursor:pointer;text-decoration:none}.secondary{background:#67766f}.danger{background:#9f342f}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #e3ebe7;vertical-align:top}.muted{color:#65756e;font-size:.9rem}.notice{padding:13px;border-radius:8px;background:#e5f5ec;margin-bottom:18px}.secret{font-family:ui-monospace,monospace;word-break:break-all;background:#12231d;color:#d6f9e8;padding:14px;border-radius:8px}.inline{display:inline}.login{max-width:440px;margin:10vh auto}code{font-size:.9em}@media(max-width:700px){table{display:block;overflow:auto}}
  </style></head><body>${body}</body></html>`;
}

function loginPage(error = ""): string {
  return page("Администрация", `<main class="login"><section class="card"><h1>Leon Chatbot</h1><p class="muted">Вход за администратори</p>${error ? `<p class="notice">${escapeHtml(error)}</p>` : ""}<form method="post" action="/admin/login"><label>Имейл</label><input name="email" type="email" autocomplete="username" required><label>Парола</label><input name="password" type="password" autocomplete="current-password" required minlength="12"><p><button type="submit">Вход</button></p></form></section></main>`);
}

async function dashboard(
  repository: AccessAdminRepository,
  session: AdminSession,
  notice = "",
  generatedKey = "",
): Promise<string> {
  const [clients, users] = await Promise.all([repository.listApiClients(), repository.listUsers()]);
  const csrf = escapeHtml(session.csrfToken);
  const roleChecks = apiRoles.map((role) => `<label class="check"><input type="checkbox" name="roles" value="${role}">${role}</label>`).join("");
  const profileChecks = assistantProfiles.map((profile) => `<label class="check"><input type="checkbox" name="profiles" value="${profile}">${profile}</label>`).join("");
  const clientRows = clients.map((client) => `<tr><td><strong>${escapeHtml(client.name)}</strong><div class="muted">${escapeHtml(client.tenantId)}</div></td><td><code>${escapeHtml(client.keyPrefix)}…</code></td><td>${client.roles.map(escapeHtml).join("<br>")}</td><td>${client.allowedProfiles.map(escapeHtml).join("<br>")}<div class="muted">по подразбиране: ${escapeHtml(client.defaultProfile)}</div></td><td>${client.active ? "Активен" : "Спрян"}<div class="muted">${client.lastUsedAt?.toISOString() ?? "неизползван"}</div></td><td><form class="inline" method="post" action="/admin/api-clients/${client.id}/toggle"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="active" value="${client.active ? "false" : "true"}"><button class="${client.active ? "danger" : "secondary"}">${client.active ? "Спри" : "Активирай"}</button></form></td></tr>`).join("");
  const userRows = users.map((user) => `<tr><td>${escapeHtml(user.email)}</td><td>${user.isAdmin ? "Администратор" : "Потребител"}</td><td>${user.active ? "Активен" : "Спрян"}</td><td><form class="inline" method="post" action="/admin/users/${user.id}/access"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="active" value="${user.active ? "false" : "true"}"><input type="hidden" name="isAdmin" value="${user.isAdmin}"><button class="${user.active ? "danger" : "secondary"}">${user.active ? "Спри" : "Активирай"}</button></form> <form class="inline" method="post" action="/admin/users/${user.id}/access"><input type="hidden" name="csrf" value="${csrf}"><input type="hidden" name="active" value="${user.active}"><input type="hidden" name="isAdmin" value="${user.isAdmin ? "false" : "true"}"><button class="secondary">${user.isAdmin ? "Премахни admin" : "Направи admin"}</button></form></td></tr>`).join("");
  return page("Администрация", `<header><strong>Leon Chatbot · Администрация</strong><form method="post" action="/admin/logout"><input type="hidden" name="csrf" value="${csrf}"><button class="secondary">Изход</button></form></header><main>${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ""}${generatedKey ? `<section class="card"><h2>Нов API ключ — копирайте го сега</h2><p>След затваряне няма да може да бъде показан отново.</p><div class="secret">${escapeHtml(generatedKey)}</div></section>` : ""}<section class="card"><h2>API клиенти</h2><table><thead><tr><th>Име / tenant</th><th>Ключ</th><th>Права</th><th>Режими</th><th>Статус</th><th></th></tr></thead><tbody>${clientRows || "<tr><td colspan=6>Няма клиенти.</td></tr>"}</tbody></table></section><div class="grid"><section class="card"><h2>Нов API клиент</h2><form method="post" action="/admin/api-clients"><input type="hidden" name="csrf" value="${csrf}"><label>Име</label><input name="name" required placeholder="EasyStart public"><label>Tenant ID</label><input name="tenantId" required placeholder="easystart"><fieldset><legend>Права</legend>${roleChecks}</fieldset><fieldset><legend>Разрешени режими</legend>${profileChecks}</fieldset><label>Режим по подразбиране</label><select name="defaultProfile">${assistantProfiles.map((p) => `<option>${p}</option>`).join("")}</select><p><button>Създай и покажи ключа</button></p></form></section><section class="card"><h2>Нов потребител</h2><form method="post" action="/admin/users"><input type="hidden" name="csrf" value="${csrf}"><label>Имейл</label><input type="email" name="email" required><label>Парола (мин. 12 знака)</label><input type="password" name="password" minlength="12" required><label class="check"><input type="checkbox" name="isAdmin" value="true"> Администратор</label><p><button>Създай</button></p></form></section></div><section class="card"><h2>Потребители</h2><table><thead><tr><th>Имейл</th><th>Роля</th><th>Статус</th><th></th></tr></thead><tbody>${userRows}</tbody></table></section></main>`);
}

export async function registerAdminRoutes(app: FastifyInstance, repository: AccessAdminRepository, secureCookies: boolean): Promise<void> {
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/admin")) return;
    reply.header("cache-control", "no-store");
    reply.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    reply.header("x-frame-options", "DENY");
  });
  app.get("/admin/login", async (_request, reply) => reply.type("text/html; charset=utf-8").send(loginPage()));
  app.post("/admin/login", async (request, reply) => {
    const now = Date.now();
    const attempt = loginAttempts.get(request.ip);
    if (attempt && attempt.resetAt > now && attempt.count >= 5) {
      return reply.status(429).type("text/html; charset=utf-8").send(loginPage("Твърде много опити. Опитайте отново след 15 минути."));
    }
    const body = form(request);
    const result = await repository.createSession(String(body.email ?? ""), String(body.password ?? ""));
    if (!result) {
      loginAttempts.set(request.ip, { count: attempt && attempt.resetAt > now ? attempt.count + 1 : 1, resetAt: now + 15 * 60 * 1000 });
      return reply.status(401).type("text/html; charset=utf-8").send(loginPage("Невалиден имейл или парола."));
    }
    loginAttempts.delete(request.ip);
    reply.setCookie(sessionCookie, result.token, { httpOnly: true, secure: secureCookies, sameSite: "strict", path: "/admin", maxAge: 12 * 60 * 60 });
    return reply.redirect("/admin");
  });
  app.get("/admin", async (request, reply) => {
    const session = await requireSession(request, reply, repository);
    if (!session) return;
    return reply.type("text/html; charset=utf-8").send(await dashboard(repository, session));
  });
  app.post("/admin/logout", async (request, reply) => {
    const session = await requireSession(request, reply, repository);
    if (!session) return;
    assertCsrf(request, session);
    const token = request.cookies[sessionCookie];
    if (token) await repository.deleteSession(token);
    reply.clearCookie(sessionCookie, { path: "/admin" });
    return reply.redirect("/admin/login");
  });
  app.post("/admin/api-clients", async (request, reply) => {
    const session = await requireSession(request, reply, repository);
    if (!session) return;
    assertCsrf(request, session);
    const body = form(request);
    const roles = selectedValues(body.roles).filter((v): v is ApiRole => apiRoles.includes(v as ApiRole));
    const profiles = selectedValues(body.profiles).filter((v): v is AssistantProfile => assistantProfiles.includes(v as AssistantProfile));
    const defaultProfile = String(body.defaultProfile ?? "") as AssistantProfile;
    const name = String(body.name ?? "").trim();
    const tenantId = String(body.tenantId ?? "").trim();
    if (!name || !tenantId) throw new HttpError(400, "INVALID_API_CLIENT", "Името и tenant ID са задължителни.");
    if (!roles.length || !profiles.length || !profiles.includes(defaultProfile)) return reply.status(400).type("text/html; charset=utf-8").send(await dashboard(repository, session, "Изберете поне едно право и режим, включващ режима по подразбиране."));
    const created = await repository.createApiClient({ name, tenantId, roles, allowedProfiles: profiles, defaultProfile });
    return reply.type("text/html; charset=utf-8").send(await dashboard(repository, session, "API клиентът е създаден.", created.key));
  });
  app.post<{ Params: { id: string } }>("/admin/api-clients/:id/toggle", async (request, reply) => {
    const session = await requireSession(request, reply, repository); if (!session) return;
    assertCsrf(request, session);
    await repository.setApiClientActive(request.params.id, String(form(request).active) === "true");
    return reply.redirect("/admin");
  });
  app.post("/admin/users", async (request, reply) => {
    const session = await requireSession(request, reply, repository); if (!session) return;
    assertCsrf(request, session); const body = form(request);
    await repository.createUser({ email: String(body.email ?? ""), password: String(body.password ?? ""), isAdmin: body.isAdmin === "true" });
    return reply.redirect("/admin");
  });
  app.post<{ Params: { id: string } }>("/admin/users/:id/access", async (request, reply) => {
    const session = await requireSession(request, reply, repository); if (!session) return;
    assertCsrf(request, session); const body = form(request);
    await repository.setUserAccess(request.params.id, { active: String(body.active) === "true", isAdmin: String(body.isAdmin) === "true" });
    return reply.redirect("/admin");
  });
}
