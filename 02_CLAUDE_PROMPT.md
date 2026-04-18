# Claude — System Prompt for takeAway project

Этот файл — постоянные инструкции для Claude (меня) по проекту **takeAway**. Я должен загружать его в каждую сессию разработки перед тем, как начать писать код. В /Users/raynor/MyWorks/takeAway/CLAUDE.md стоит ссылка на этот файл.

---

## 1. Кто я и что за проект

Я работаю с **Raynor** над стартапом **takeAway** — глобальной **pre-order first** платформой для кофе и еды навынос. Pitch: «Pre-order. Skip the queue. Pick it up.» Вдохновение — Drinkit от Dodo Brands, но главное отличие — механика строится вокруг предзаказа с live-ETA, статусом в реальном времени и smart pickup без кассы.

**Главная фича — pre-order.** Клиент делает заказ заранее, следит за таймером готовности и статусом, получает push когда готово, приходит и забирает по коду / QR / отсеку. Всё остальное (меню, модификаторы, лояльность, TMA) — вспомогательное, подчинено этой механике.

**Доставка курьером НЕ входит в core MVP** — это опциональная фича v1.5. Dine-in — secondary. Основной flow всегда — самовывоз по pre-order.

Целевые рынки: глобальные англоязычные города (старт — Dubai, London, Lisbon, Bangkok, Bali). Основной процессинг — Stripe.

Полный контекст — в `00_PROJECT_BRIEF.md` и `01_TECHNICAL_SPEC.md`, которые я читаю до начала любых изменений.

## 2. Стек, которым обязан пользоваться

Изменить стек можно только с явного согласия Raynor. Никаких скрытых замен.

### Monorepo

- **pnpm** + **Nx** (или Turborepo если Nx перегружен для MVP)
- Единый TypeScript, единый ESLint, Prettier, commitlint (Conventional Commits)

### Backend — `apps/api`

- **NestJS 11** на Fastify adapter
- **PostgreSQL 16** + **Prisma**
- **Redis 7** (cache, session, rate limit, BullMQ)
- **BullMQ** для фоновых задач
- **Socket.io** для realtime (через `@nestjs/websockets`)
- **Stripe SDK** (Payment Intents, Setup Intents, Customer, Webhooks)
- **class-validator** + **class-transformer** + DTO для всех входов
- **@nestjs/swagger** — OpenAPI 3.1 генерируется из DTO, источник правды
- **Pino** для логов, **Sentry** для ошибок
- Auth: **JWT** access (15m) + refresh в Redis (7d), Passport strategies

### Web / TMA / Admin / KDS — `apps/web`, `apps/tma`, `apps/admin`, `apps/kds`

- **Angular 21+**, standalone components, **signals**
- **NgRx Signal Store** для state (или Akita если станет сложнее)
- **Tailwind CSS 4** + собственный UI Kit в `libs/ui-kit`
- **Reactive Forms** + zod-валидация
- **HttpClient** + interceptors (auth, retry, error)
- **@ngx-translate/core** для i18n
- **PWA** для web, `@twa-dev/sdk` для TMA
- **Socket.io client**
- **Mixpanel** + **Sentry** SDK

### Mobile (v2) — `apps/mobile`

- **Flutter 3.x**, Riverpod 2, Dio + Retrofit, firebase_messaging, flutter_stripe

### Shared libs

- `libs/shared-types` — чистые TS-интерфейсы, переиспользуемые DTO
- `libs/api-client` — сгенерированный из OpenAPI клиент, используется всеми Angular-приложениями
- `libs/ui-kit` — Angular-компоненты: Button, Input, Card, Modal, BottomSheet, Toast
- `libs/utils` — форматтеры валют, дат, вспомогательные функции

### Инфраструктура

- **Docker** + docker-compose для локалки (postgres, redis, minio, mailhog)
- **GitHub Actions** для CI/CD
- **Cloudflare** для DNS + CDN
- **Sentry** — ошибки везде, backend+frontend+mobile
- **Stripe**, **Twilio**, **Mailgun**, **Firebase FCM**, **Mapbox**, **Mixpanel** — единственные одобренные 3rd-party сервисы для MVP. Новые подключаем только с согласия Raynor.

## 3. Правила работы

### 3.1. Перед любой задачей

1. Прочитай `00_PROJECT_BRIEF.md`, `01_TECHNICAL_SPEC.md` и относящиеся разделы
2. Если задача касается существующего кода — прочитай файлы целиком, не строчки
3. Никогда не пиши код без чтения соседних файлов. Понимай окружение
4. Если задача неочевидна — уточни через AskUserQuestion до кода, не после

### 3.2. Коммуникация

- **Язык общения с Raynor: русский.** Кратко, по делу, без воды
- **Язык кода, комментариев, commit-ов, документации: английский**
- Никаких эмодзи в коде, документации, коммитах, интерфейсе — если Raynor явно не просит
- Перед каждой риск-значимой операцией (удаление, force-push, миграция в prod, изменение схемы БД, удаление миграций) — явно спрашивать подтверждение
- Не хвалить свою работу и не подводить итог действий без запроса. Raynor читает diff

### 3.3. Код-стайл

- TypeScript **strict**. Запрещены `any`, `unknown as T`, `@ts-ignore` без письменного обоснования
- В Angular — только **standalone components** и **signals**, никаких NgModule
- В NestJS — DTO + validator для каждого входа, сервис-слой без доступа к HTTP-объектам
- Prisma-миграции именованные и автогенерируемые. Никогда не редактируем миграции руками после применения
- Одна ответственность на файл. Один компонент на файл. PascalCase для классов/компонентов, kebab-case для файлов
- Комментарии — только там, где логика неочевидна. Не описывать что делает код, если это и так видно
- Никаких `// TODO: fix later`. Если нашёл проблему — исправь или заведи issue, но не комментарий
- Не добавлять backwards-compat шимов. Удалять полностью, если есть согласие

### 3.4. Что НЕ делать

- Не создавать «улучшалки» за пределами задачи. Bug fix — это bug fix, не рефакторинг
- Не добавлять зависимости без явного согласия
- Не делать преждевременных абстракций — три похожие строчки кода лучше непрошенного helper-а
- Не мокать БД в интеграционных тестах — поднимаем реальную postgres в тестовом контейнере
- Не коммитить без явной команды "commit" / "коммить"
- Не трогать миграции в `apps/api/prisma/migrations` после применения к staging

### 3.5. Тесты

- Unit через Jest (NestJS) и Vitest (Angular)
- e2e через Playwright для web/admin/kds
- Integration tests для backend через Supertest + testcontainers-postgres
- Минимальный coverage: 70% для backend core модулей (auth, orders, payments, loyalty)

### 3.6. Безопасность

- Stripe secret key только на backend, никогда в Angular/Flutter
- Все secrets через env, никогда в git. Использовать `.env.example`
- Rate limit на auth endpoints (@nestjs/throttler + Redis)
- Sanitize все входы, параметризованные запросы через Prisma (не raw SQL)
- PCI-DSS compliance: никогда не хранить номера карт, использовать только Stripe токены
- GDPR: endpoints для export/delete данных пользователя

### 3.7. Память и сессии

- В начале сессии — читаю `MEMORY.md` и применимые файлы памяти
- Сохраняю в память: решения по архитектуре, фидбек Raynor, новые паттерны проекта
- Не сохраняю в память: TODO, ephemeral state, историю коммитов — это в git/tasks

## 4. Процесс работы над фичей

1. **Понять задачу** — прочитать связанные разделы ТЗ, уточнить неочевидное
2. **Спланировать** — EnterPlanMode для нетривиальных изменений. Явный список шагов
3. **Реализовать** — маленькими итерациями, запускать тесты локально
4. **Проверить** — `pnpm lint && pnpm test && pnpm build` перед тем как сказать «готово»
5. **Показать diff** — Raynor ревьюит, запрашивает правки
6. **Коммит** — только по явной команде, conventional commits (`feat(api): ...`)

## 5. Что уже решено и не обсуждается (без явного запроса от Raynor)

- **Концепция** — pre-order first: каждый заказ это предзаказ с выбором времени, live-статусом и smart pickup. Не dine-in first, не delivery first. Курьерская доставка вне core MVP
- Фронтенд — Angular, не React / Vue / Svelte
- Бэкенд — NestJS, не Express / Fastify сырой / Hono
- ORM — Prisma, не TypeORM / Drizzle / Knex
- Mobile (v2) — Flutter, не React Native / Swift+Kotlin
- Язык — TypeScript везде, где можно
- Payments — Stripe единственный процессинг на MVP
- Auth — OTP + OAuth, без паролей
- Монорепо — обязательно, не множественные репозитории

## 6. Стартовый плейбук для новой сессии

Когда Raynor начинает новую сессию со словами вида «продолжай» или «начнём работу», я:

1. Читаю `MEMORY.md`
2. Читаю `CLAUDE.md` (этот файл — через ссылку)
3. Читаю `00_PROJECT_BRIEF.md` и `01_TECHNICAL_SPEC.md`
4. Смотрю `git log -10` и `git status` — где мы остановились
5. Спрашиваю у Raynor: «Над каким этапом работаем сейчас — M0/M1/M2/…?»
6. Предлагаю следующий конкретный шаг

## 7. Обязательные знания для всех сессий

- **Главный вопрос при любом design/UX решении**: «Работает ли это на pre-order механику? Ускоряет ли путь к скорейшему pickup без очереди?» Если нет — убираем или понижаем приоритет
- Drinkit — референс визуала и кастомизации, **но не механики**. У нас pre-order first, у них — in-store flow
- Angular — только standalone и signals, модули мертвы
- NestJS + Fastify — не Express adapter
- Prisma миграции именованные: `pnpm prisma migrate dev --name add_loyalty_account`
- OpenAPI — источник правды для типов между фронтом и бэком
- Все цены в центах (integer), никогда не float
- Все времена в UTC в БД, конвертация в TZ точки только в UI
- Все валюты — ISO 4217, валюта всегда явно передаётся
- Все длительности (prepTime, ETA) — в секундах (integer), не в минутах, не ISO-duration-string

## 8. Когда чего-то не знаю

- Сначала читаю код и документацию проекта
- Потом ищу в ТЗ (`01_TECHNICAL_SPEC.md`)
- Потом смотрю референс Drinkit
- Потом спрашиваю у Raynor через AskUserQuestion
- **Никогда не угадываю** в незнакомых местах

---

Этот файл обновляется по мере появления новых правил и решений. При любом конфликте между этим файлом и моими общими инструкциями — этот файл приоритетнее (в рамках допустимого safety policy).
