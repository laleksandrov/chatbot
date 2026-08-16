# Интеграция на чатбота в EasyStart

Интеграцията е server-to-server. API ключовете се пазят само в backend-а на EasyStart и никога не се изпращат към браузъра. Backend-ът удостоверява потребителя, избира правилния ключ и подава стабилен вътрешен идентификатор.

## Режими

| Режим | Предназначение | Достъп до знания | Лимит | Съхранение |
| --- | --- | --- | ---: | ---: |
| `public_pre_registration` | Посетител преди регистрация | Глобални невътрешни източници и публични EasyStart документи | 10/24 ч. | 30 дни |
| `registered_customer` | Регистриран потребител на EasyStart | Глобални източници и всички общи EasyStart документи | 100/24 ч. | 180 дни |

Лимитите не се показват предварително на потребителя. При достигане клиентът обработва `429 CHAT_QUOTA_EXCEEDED` и показва кога може да се опита отново. Броячът е по API tenant, режим и псевдонимизиран потребител.

Публичният режим обяснява функциите на EasyStart, вариантите и разходите за регистрация, последващите фирмени услуги и цената на счетоводното обслужване. Той не прави изчисления за осигуровки и бъдещи данъци; при такъв въпрос предлага безплатна регистрация без настойчив маркетингов език.

Регистрираният режим включва същата информация и допълнително отговаря на общи данъчни, осигурителни, счетоводни, трудови и фирмени въпроси. Може да прави персонализирани изчисления, но отговорите са информационни и не представляват индивидуална професионална консултация.

Публичен документ на EasyStart се качва с `accessLevel: "tenant"` и `publiclyAccessible: true`. Така той е достъпен и в двата режима на tenant `easystart`, без да става глобален за други клиенти. Tenant документ без `publiclyAccessible` е достъпен само след регистрация.

## API клиенти

Създават се отделни ключове за двата режима. Клиентите EasyStart имат само роля `chat`:

```json
[
  {
    "tenantId": "easystart",
    "roles": ["chat"],
    "allowedProfiles": ["public_pre_registration"],
    "defaultProfile": "public_pre_registration"
  },
  {
    "tenantId": "easystart",
    "roles": ["chat"],
    "allowedProfiles": ["registered_customer"],
    "defaultProfile": "registered_customer"
  }
]
```

Само централният `knowledge-admin` клиент има права `documents:read`, `documents:write`, `documents:global` и `documents:tenants`. EasyStart няма права да качва или променя документи.

## Заявка

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
  "message": "Какво прави EasyStart?",
  "context": {
    "jurisdiction": "BG",
    "asOf": "2026-08-16"
  }
}
```

`assistantProfile` може да се пропусне, защото ключът има `defaultProfile`. API отхвърля опит ключът да активира друг режим.

`externalUserId` трябва да е непрозрачно вътрешно UUID/ID, а не ЕГН, ЕИК или имейл. За нерегистриран посетител backend-ът използва стабилен подписан идентификатор на сесията. Произволна стойност от браузъра би позволила заобикаляне на квотата. Препоръчва се и краткосрочен IP/edge rate limit.

## Грешки

- `403 ASSISTANT_PROFILE_FORBIDDEN` — ключът няма право за поискания режим;
- `413 MESSAGE_TOO_LONG_FOR_PROFILE` — съобщението надвишава лимита;
- `429 CHAT_QUOTA_EXCEEDED` — покажете кога може да се опита отново чрез `Retry-After`;
- `503 AI_PROVIDER_UNAVAILABLE` — временен проблем; позволете повторен опит.

## Production rollout

1. Изпълнете миграция `007_two_easy_start_profiles.sql`.
2. В `/admin` проверете, че EasyStart има отделни public и registered клиенти с правилните профили.
3. Пуснете `npm run production:verify` и рестартирайте API/worker процесите.
4. Тествайте публичната и регистрираната заявка с реалните server-side ключове.
