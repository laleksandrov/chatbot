# Управление на потребители и API достъп

Достъпът има два отделни модела. Таблицата `users` съдържа хората, които влизат в `/admin`. Таблицата `api_clients` съдържа машинните клиенти като EasyStart, EMS и локалния uploader за базата знания. EasyStart и EMS нямат човешки акаунти и не могат да администрират документи, освен ако изрично не им бъде дадено такова API право.

## Права

- `chat` — изпращане на чат заявки;
- `documents:read` — проверка на документи;
- `documents:write` — качване и повторна обработка;
- `documents:global` — работа с глобалната база знания;
- `documents:tenants` — работа от името на различни tenants.

Всеки API клиент има отделен tenant, списък от права и разрешени assistant profiles. За EasyStart public и registered се създават различни клиенти и различни ключове. EMS получава само `chat` и `accounting_client`. Централният `knowledge-admin` ключ се пази локално в `.env.ingestion` и единствен той получава document правата.

Новият API ключ се показва само веднъж. В PostgreSQL се пази SHA-256 хеш и кратък prefix за разпознаване. Паролите се пазят със scrypt, а администраторските сесии са 12-часови, с HttpOnly/SameSite cookie и CSRF token. Последният активен администратор не може да бъде спрян или понижен.

## Първоначално активиране във Forge

Първият deployment изпълнява `npm run db:migrate` и създава таблиците. Оставете стария `API_CLIENTS_JSON` временно във Forge, за да продължат да работят клиентите по време на миграцията.

В директорията `current` създайте първия администратор, без да записвате паролата в `.env`:

```bash
cd /home/forge/chatbot.leon.bg/current
read -s -p "Admin password: " ADMIN_PASSWORD
echo
export ADMIN_EMAIL="admin@leon.bg" ADMIN_PASSWORD
npm run admin:create
unset ADMIN_EMAIL ADMIN_PASSWORD
```

След това внесете съществуващите API клиенти:

```bash
npm run api-clients:import-env
```

Влезте в `https://chatbot.leon.bg/admin`, проверете клиентите и направете тест с EasyStart и EMS. Едва след успешния тест сменете Forge environment на:

```dotenv
API_CLIENTS_JSON=[]
```

и рестартирайте API процеса. Новите клиенти, права, ключове и администратори оттук нататък се управляват само през `/admin`.

## Ротация на ключ

Създайте нов API клиент със същите tenant/profile права, копирайте новия ключ в клиента и потвърдете тестова заявка. След това спрете стария ключ от `/admin`. Това позволява ротация без прекъсване и пази историята на последното използване на стария клиент.
