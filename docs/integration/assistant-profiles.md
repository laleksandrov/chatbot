# Интеграция на чатбота в платформата и EMS

Интеграцията е server-to-server. API ключовете се пазят само в backend-а на клиента и никога не се изпращат към браузъра. Backend-ът удостоверява потребителя, избира правилния API ключ и подава собствените си стабилни идентификатори за потребител и организация.

## Режими

| Режим | Предназначение | Достъп до знания | Лимит | Съхранение | Ескалация |
| --- | --- | --- | ---: | ---: | --- |
| `public_pre_registration` | Посетител преди регистрация | Само глобални, не-вътрешни източници | 10/24 ч. | 30 дни | Не |
| `registered_customer` | Регистриран потребител на платформата | Глобални и общи документи на платформата | 50/24 ч. | 180 дни | Не |
| `accounting_client` | Удостоверен клиент на счетоводната фирма | Глобални, общи EMS знания и документи само на конкретната организация | 200/24 ч. | 365 дни | Към EMS |

Лимитите са начални продуктови стойности и могат да се променят в `src/profiles.ts`. Броячът е по API tenant, режим и псевдонимизиран потребител.

## API клиенти

Използват се три отделни ключа. Разрешеният режим се определя от сървъра, а не от стойност, избрана в браузъра:

```json
[
  {
    "tenantId": "new-platform-public",
    "key": "...",
    "roles": ["chat"],
    "allowedProfiles": ["public_pre_registration"],
    "defaultProfile": "public_pre_registration"
  },
  {
    "tenantId": "new-platform",
    "key": "...",
    "roles": ["chat"],
    "allowedProfiles": ["registered_customer"],
    "defaultProfile": "registered_customer"
  },
  {
    "tenantId": "ems",
    "key": "...",
    "roles": ["chat", "documents:read", "documents:write", "documents:global"],
    "allowedProfiles": ["accounting_client"],
    "defaultProfile": "accounting_client"
  }
]
```

## Заявка за чат

```http
POST https://chatbot.leon.bg/v1/chat
Authorization: Bearer <server-side-api-key>
Content-Type: application/json
```

```json
{
  "channel": "web",
  "externalUserId": "platform-user-123",
  "conversationId": "optional-stable-conversation-id",
  "message": "Какъв е срокът за подаване на VIES декларация?",
  "context": {
    "jurisdiction": "BG",
    "asOf": "2026-08-14"
  }
}
```

`assistantProfile` може да се пропусне, защото ключът има `defaultProfile`. Дори да бъде подаден друг режим, API го отхвърля, ако не е разрешен за ключа.

За `accounting_client` backend-ът задължително добавя организацията, след като е проверил, че текущият потребител има достъп до нея:

```json
{
  "channel": "ems",
  "externalUserId": "ems-user-123",
  "externalOrganizationId": "ems-company-456",
  "message": "Как се отразява тази фактура?"
}
```

Не приемайте `externalOrganizationId` директно от browser body. Изведете го от удостоверената EMS сесия или проверете членството на потребителя преди proxy заявката.

Идентификаторите трябва да са непрозрачни вътрешни UUID/ID стойности, а не ЕГН, ЕИК, имейл или друго лично/фирмено означение. За нерегистриран посетител backend-ът трябва да използва стабилен подписан идентификатор на сесията; произволна стойност от браузъра би позволила заобикаляне на продуктовата квота. Отделно от тази квота се препоръчва краткосрочен IP/edge rate limit срещу злоупотреба.

## Фирмени документи

Документ за конкретен счетоводен клиент се качва като tenant документ с `organizationId`:

```json
{
  "tenantId": "ems",
  "organizationId": "ems-company-456",
  "title": "Счетоводна политика на клиента",
  "category": "accounting",
  "sourceType": "internal",
  "accessLevel": "tenant",
  "jurisdiction": "BG"
}
```

File Search филтърът за счетоводния режим допуска глобални източници, общи tenant документи на EMS и фирмени документи със същите `tenantId` и `organizationId`. Документ с организация не може да бъде качен като `global`.

## Обработка на отговора

Отговорът съдържа използвания режим, оставаща квота и capabilities:

```json
{
  "status": "answered",
  "answer": "...",
  "assistantProfile": "accounting_client",
  "capabilities": {
    "humanEscalation": true,
    "organizationDocuments": true
  },
  "quota": {
    "limit": 200,
    "remaining": 199,
    "resetAt": "2026-08-15T00:00:00.000Z"
  },
  "conversationId": "...",
  "requestId": "...",
  "sources": []
}
```

При `status: "human_escalation"` EMS трябва да създаде задача/казус за човек и да запази `conversationId` и `requestId` като връзка към разговора. Самото създаване на EMS казуса е отделна интеграционна стъпка; чатбот API не записва директно в EMS.

## HTTP грешки, които клиентът трябва да обработва

- `400 ORGANIZATION_REQUIRED` — липсва организация в счетоводния режим;
- `403 ASSISTANT_PROFILE_FORBIDDEN` — ключът няма право за поискания режим;
- `413 MESSAGE_TOO_LONG_FOR_PROFILE` — съобщението надвишава лимита на режима;
- `429 CHAT_QUOTA_EXCEEDED` — покажете кога може да се опита отново чрез `Retry-After`;
- `503 AI_PROVIDER_UNAVAILABLE` — временен проблем; позволете повторен опит.

## Production rollout

1. Изпълнете миграция `003_assistant_profiles_and_quotas.sql`.
2. Създайте три различни случайни API ключа във Forge `.env`.
3. Рестартирайте API и worker процесите и изпълнете `npm run production:verify`.
4. Re-index-ирайте съществуващите tenant документи, за да получат атрибут `documentScope`; глобалните документи не изискват това.
5. Пуснете интеграцията първо с тестови потребител и организация и проверете, че чужд `organizationId` не връща фирмени източници.
