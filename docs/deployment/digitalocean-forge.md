# DigitalOcean и Forge production setup

## 1. PostgreSQL

Създай DigitalOcean Managed PostgreSQL cluster със следните настройки:

- име: `chatbot-production`;
- PostgreSQL: актуална поддържана major версия;
- plan: Basic / най-малкият подходящ размер за първия EMS пилот;
- region/datacenter: същият като Forge Droplet-а;
- nodes: 1 за пилота; standby се добавя преди production SLA;
- project и VPC: същите като Droplet-а.

В `Network Access` добави само Forge Droplet-а като trusted source. Не оставяй неограничен публичен достъп. Избери private/VPC connection string, когато Droplet-ът и базата са в един VPC.

Създай отделни database и user за приложението, например `chatbot` и `chatbot_app`. Не използвай `doadmin` като runtime user след първоначалното създаване и grant-овете.

Копирай TLS connection URI за ограничения application user като `DATABASE_URL` във Forge environment. Ако миграциите изискват по-високи права, запиши admin URI отделно като `MIGRATION_DATABASE_URL`; то се използва само от `npm run db:migrate`. Не записвай нито едно от двете в Git.

## 2. OpenAI

В OpenAI Platform създай отделен project за production и project API key с име `chatbot-production`. Създай vector store с име `chatbot-production` и запиши ID-то му като `OPENAI_VECTOR_STORE_ID`.

Ключът и vector-store ID се записват само във Forge environment:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=<secret>
OPENAI_VECTOR_STORE_ID=<vs_...>
```

## 3. Други production secrets

Генерирай отделни стойности за:

- `CONVERSATION_ENCRYPTION_KEY`: 32 random bytes, Base64 encoded;
- EMS API key: минимум 32 random bytes;
- `API_CLIENTS_JSON`: EMS tenant с необходимите роли.

Примерната структура е в `.env.example`. Реалните стойности не трябва да попадат в shell history, Git, deployment logs или chat.

## 4. Forge deploy script

Замени `<site-directory>` с реалната директория на сайта:

```bash
set -euo pipefail

cd <site-directory>
git pull origin main
npm ci
npm run check
npm run build
npm run db:migrate
npm run production:verify
```

`production:verify` проверява достъпа до OpenAI vector store. Статус `expired` и хранилище без нито един обработен файл спират deployment-а. Статус `in_progress` с вече налични `completed` файлове се отчита като предупреждение, защото ingestion worker-ът може нормално да индексира нови документи по време на deployment.

`production:verify` е read-only проверка на приложените миграции, ingestion колоните и достъпа до OpenAI vector store.

## 5. Процеси

Добави два отделни Forge daemon/Supervisor процеса със същата site directory:

```text
npm start
npm run worker
```

И двата процеса трябва да се рестартират след успешен deployment. API слуша само на `127.0.0.1:3000`; Nginx е публичната TLS граница.

## 6. Приемателен тест

1. `GET /health` връща `200 {"status":"ok"}`.
2. `GET /ready` връща `200 {"status":"ready"}` и реално изпълнява `SELECT 1` към PostgreSQL.
3. Качи малък EMS `.txt` документ през `POST /v1/admin/documents`.
4. Следи `GET /v1/admin/documents/{id}`, докато статусът стане `ready`.
5. Задай въпрос през `POST /v1/chat` и потвърди, че източникът е каченият файл.
6. Потвърди, че tenant документът не се намира с API ключ на друг tenant.

При неуспех не прави документа global и не разширявай trusted sources. Провери worker log, document `error`, PostgreSQL TLS/VPC връзката и OpenAI project/vector-store ID.
