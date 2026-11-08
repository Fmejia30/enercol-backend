# EnerCol backend

[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-12-e0234e?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.10-2d3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169e1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

API de EnerCol para el análisis técnico y la revisión de informes postventa. Este repositorio es el backend de la prueba de concepto: autentica contra Amazon Cognito, guarda la sesión en el servidor y autoriza por roles. No incluye el frontend ni el módulo de informes.

## Objetivos y alcance

La prueba de concepto demuestra el acceso al sistema antes de construir los flujos de negocio.

| Incluido | Fuera de este repositorio |
| --- | --- |
| Autenticación BFF con `USER_PASSWORD_AUTH` | Aplicación React |
| Sesión en PostgreSQL y cookie `HttpOnly` | Informes, revisión y auto-validación expuesta por HTTP |
| Renovación de tokens dentro de la sesión | Administración de usuarios y grupos |
| Autorización por grupos de Cognito | MFA obligatorio, bloqueo tras cinco intentos y sesión de 60 minutos |
| Health check de PostgreSQL | Auditoría en base de datos o CloudWatch |

MFA como política, el bloqueo de cuenta y la sesión de 60 minutos siguen pendientes de Seguridad. No están implementados. La política de auto-validación existe en código (`decideReportValidation`) y la aplicará el módulo Review cuando exista.

## Stack

| Capa | Tecnología |
| --- | --- |
| Runtime | Node.js 24 (mínimo 24.15.0) y pnpm 12.10.1 |
| API | NestJS 12, Express, ESM |
| Lenguaje | TypeScript 6.0.3 |
| Identidad | Amazon Cognito, AWS SDK v3 y `aws-jwt-verify` |
| Persistencia | PostgreSQL 17, Prisma 7.10.1 y `@prisma/adapter-pg` |
| Validación | `class-validator` y `class-transformer` |
| Contrato | OpenAPI con `@nestjs/swagger` |
| Pruebas | Jest 30 y Supertest |

## Arquitectura

Monolito modular. Cada módulo separa `domain`, `application`, `infrastructure` y `presentation`. Prisma vive en `src/infrastructure/database` y lo consume el módulo que lo necesita.

```mermaid
flowchart LR
  browser[Navegador]
  api[NestJS]
  cognito[Amazon Cognito]
  db[(PostgreSQL)]

  browser -->|"correo y contraseña"| api
  api -->|"USER_PASSWORD_AUTH"| cognito
  cognito -->|"tokens"| api
  api -->|"tokens cifrados y sesión"| db
  api -->|"cookie HttpOnly"| browser
```

Principios que ya rigen el código:

- Cognito es la fuente de usuarios, contraseñas y grupos. PostgreSQL no tiene tablas `User` ni `Role`.
- El navegador no recibe access token, ID token ni refresh token.
- Las rutas están cerradas por defecto. Sin `@Public()`, `@Authenticated()` o `@Roles()` una petición autenticada responde 403.
- La configuración inválida detiene el arranque. Los mensajes nombran la variable y no imprimen secretos.
- Los errores HTTP salen con `statusCode`, `error`, `message`, `path` y `timestamp`. El cuerpo no incluye la traza.

## Estructura

```text
src/
  main.ts                         Arranque, Swagger y configuración HTTP
  app.module.ts
  config/                         Entorno y validación
  infrastructure/database/        PrismaService
  modules/auth/                   Sesión BFF y Cognito
  modules/identity-access/        Verificación JWT, guards y roles
  modules/health/
  shared/http/                    CORS, origen, validación y filtro de errores
  shared/observability/           Eventos de seguridad en el logger
prisma/                           Esquema y migraciones
docs/architecture/                Identidad y autenticación BFF
test/                             Pruebas e2e
```

El cliente de Prisma se genera en `src/generated` y no se versiona.

## Autenticación y sesiones

El flujo es un BFF. React, cuando exista, enviará correo y contraseña a NestJS. NestJS llama a Cognito con `InitiateAuth` y `USER_PASSWORD_AUTH`, calcula `SECRET_HASH` y guarda los tokens cifrados con AES-256-GCM. El navegador recibe la cookie de sesión y un token CSRF.

```mermaid
sequenceDiagram
  participant Web as Cliente
  participant API as NestJS
  participant IdP as Cognito
  participant DB as PostgreSQL

  Web->>API: POST /auth/login
  API->>IdP: InitiateAuth
  IdP-->>API: tokens o desafío
  API->>DB: AuthSession cifrada
  API-->>Web: cookie y usuario, sin tokens
  Web->>API: GET /identity/me
  API->>DB: sesión vigente
  API-->>Web: userId y roles
```

| Pieza | Comportamiento |
| --- | --- |
| Cookie de sesión | `COOKIE_NAME`, `HttpOnly`, `Path=/`, `Secure` y `SameSite` configurables |
| Cookie CSRF | `{COOKIE_NAME}_csrf`. El logout exige `X-CSRF-Token` |
| Identificador | Opaco en la cookie. En PostgreSQL se guarda su hash |
| Vigencia | Absoluta, `SESSION_ABSOLUTE_TTL_SECONDS` (8 horas por defecto). Inactividad, `SESSION_IDLE_TTL_SECONDS` (30 minutos por defecto) |
| Renovación | Si al access token le faltan 5 minutos o menos, `GetTokensFromRefreshToken` dentro de `SELECT … FOR UPDATE`. No hay `POST /auth/refresh` ni `REFRESH_TOKEN_AUTH` |
| Rechazo de Cognito | La sesión local se revoca. Hay que volver a iniciar sesión |
| Desafíos | `NEW_PASSWORD_REQUIRED`, `SMS_MFA`, `SOFTWARE_TOKEN_MFA`, `EMAIL_OTP` y `MFA_SETUP` |

`GET /auth/session` y las rutas protegidas reutilizan esa sesión. La renovación no alarga `expiresAt`.

En `NODE_ENV=development`, CORS refleja el origen recibido y acepta clientes sin encabezado `Origin`, como Postman. En cualquier otro entorno solo se admite `FRONTEND_ORIGIN`. `credentials` permanece activo. No se usa `Access-Control-Allow-Origin: *`.

Un cliente que ya posee un access token del mismo App Client puede enviarlo como `Authorization: Bearer`. Si la petición trae una cookie de sesión inválida, el bearer no la sustituye.

El detalle está en [docs/architecture/autenticacion-bff.md](docs/architecture/autenticacion-bff.md).

## Autorización

`JwtAuthGuard` autentica. `RolesGuard` autoriza con lo que declara el handler.

| Declaración | Resultado |
| --- | --- |
| `@Public()` | Sin autenticación ni rol |
| `@Authenticated()` | Exige usuario. No exige un rol reconocido |
| `@Roles(...)` | Exige al menos uno de los roles. Varios argumentos se evalúan con OR |
| Ninguna | 403 si ya hay usuario. La ruta no queda abierta |

| Grupo de Cognito | Rol interno |
| --- | --- |
| `ESPECIALISTA_TECNICO` | `SPECIALIST` |
| `ESPECIALISTA_VALIDADOR` | `VALIDATOR` |

Un token puede traer ambos grupos. Un grupo desconocido no otorga permiso. Un usuario autenticado sin roles reconocidos puede llamar `GET /api/v1/identity/me` y recibe 403 en una ruta `@Roles()`.

| Situación | HTTP |
| --- | --- |
| Sin sesión ni bearer | 401 `Se requiere autenticación` |
| Sesión o token inválido | 401 `No fue posible autenticar la solicitud` |
| Usuario autenticado sin el rol | 403 `No tiene permiso para realizar esta acción` |

El detalle está en [docs/architecture/identidad-y-acceso.md](docs/architecture/identidad-y-acceso.md).

## Endpoints

Prefijo `/api/v1`.

| Método | Ruta | Acceso | Respuesta |
| --- | --- | --- | --- |
| `GET` | `/health` | Público | 200 si PostgreSQL responde. 503 si no |
| `POST` | `/auth/login` | Público, con origen válido | 200 con sesión o desafío. 401 genérico. 429 por límite local |
| `POST` | `/auth/challenge` | Público, con origen válido | El mismo contrato, con el identificador opaco del desafío |
| `GET` | `/auth/session` | Cookie | 200 `{ authenticated: false }` o el usuario y `csrfToken` |
| `POST` | `/auth/logout` | Cookie, origen y CSRF | 204. Revoca la sesión aunque Cognito no responda |
| `GET` | `/identity/me` | Sesión o bearer | `{ userId, roles }` |

`POST /auth/login` recibe `{ "email", "password" }`. `POST /auth/challenge` recibe `{ "challengeId", "code?", "newPassword?", "attributes?" }`. Ninguna respuesta incluye tokens de Cognito.

## Requisitos e instalación

- Node.js 24, desde 24.15.0 y menor que 25
- pnpm 12.10.1 (`packageManager` del proyecto)
- Docker, si se usa el PostgreSQL de `docker-compose.yml`

```bash
pnpm install
cp .env.example .env
docker compose up -d
```

`docker-compose.yml` crea la base `enercol` con usuario y contraseña `enercol`. Si se usa ese contenedor, `DATABASE_URL` debe ser:

```text
postgresql://enercol:enercol@localhost:5432/enercol
```

El valor de `.env.example` es un ejemplo y hay que alinearlo con la base que realmente se ejecute. También hay que completar el App Client, su secreto y la clave de sesión:

```bash
openssl rand -base64 32
```

`COGNITO_ISSUER` y `COGNITO_JWKS_URI` tienen que corresponder a `COGNITO_REGION` y `COGNITO_USER_POOL_ID`. Si no coinciden, el proceso no arranca.

```bash
pnpm prisma:generate
pnpm prisma:migrate
pnpm start:dev
```

La API queda en `http://localhost:3000/api/v1`. `pnpm prisma:generate` también corre antes de `pnpm build`.

## Variables de entorno

Definidas en `.env.example`. No hay secretos reales en el repositorio.

| Variable | Uso |
| --- | --- |
| `NODE_ENV` | `development`, `test` o `production` |
| `PORT` | Puerto HTTP. Por defecto `3000` |
| `DATABASE_URL` | Conexión PostgreSQL |
| `COGNITO_REGION` | Región del User Pool |
| `COGNITO_USER_POOL_ID` | Identificador del pool. Debe empezar por la región |
| `COGNITO_CLIENT_ID` | App Client confidencial |
| `COGNITO_CLIENT_SECRET` | Secreto de ese cliente |
| `COGNITO_ISSUER` | Emisor JWT del mismo pool |
| `COGNITO_JWKS_URI` | JWKS de ese emisor |
| `SESSION_ENCRYPTION_KEY` | 32 bytes en base64 para AES-256-GCM |
| `SESSION_ABSOLUTE_TTL_SECONDS` | Expiración absoluta. Por defecto `28800` |
| `SESSION_IDLE_TTL_SECONDS` | Inactividad. Por defecto `1800`. No puede superar la absoluta |
| `COOKIE_NAME` | Nombre de la cookie de sesión. Por defecto `enercol_session` |
| `COOKIE_SECURE` | `true` o `false`. En producción, si se omite, queda `true` |
| `COOKIE_SAME_SITE` | `lax`, `strict` o `none`. `none` exige `COOKIE_SECURE=true` |
| `FRONTEND_URL` | URL del frontend |
| `FRONTEND_ORIGIN` | Origen exacto permitido fuera de desarrollo |

## Ejecución, migraciones y pruebas

| Comando | Acción |
| --- | --- |
| `pnpm start:dev` | Arranque con recarga |
| `pnpm start:debug` | Arranque con inspector y recarga |
| `pnpm build` | Genera el cliente Prisma y compila a `dist/` |
| `pnpm start:prod` | Ejecuta `node dist/main` |
| `pnpm prisma:migrate` | `prisma migrate dev` |
| `pnpm test` | Pruebas unitarias |
| `pnpm test:e2e` | Pruebas de extremo a extremo |
| `pnpm test:cov` | Cobertura |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |

Jest se ejecuta con `node --experimental-vm-modules` porque NestJS 12 y el cliente de Prisma son ESM. Los scripts ya incluyen el flag. El proceso de la API no lo necesita.

Las pruebas unitarias y e2e no llaman a Cognito ni exigen una base en ejecución: el acceso a datos se sustituye. `pnpm prisma:migrate` sí necesita PostgreSQL.

Las migraciones actuales crean `auth_session` y `auth_challenge`. La segunda elimina `auth_transaction`, que pertenecía al flujo OAuth anterior.

## Swagger

Con `NODE_ENV` distinto de `production`, la documentación queda en `http://localhost:3000/api/swagger`. En producción no se monta. El esquema bearer documenta el access token de Cognito para clientes como Postman.

## Convenciones

- El proyecto es ESM (`"type": "module"`). Los imports relativos terminan en `.js`. No se compila a CommonJS: el cliente de Prisma usa `import.meta`.
- TypeScript permanece en 6.0.3 y Prisma en 7.10.1.
- Un módulo nuevo sigue las cuatro capas y no duplica la verificación de tokens ni el mapeo de roles.
- `@Public()`, `@Authenticated()` y `@Roles()` se declaran en el handler. El guard no acepta roles enviados por el cliente.
- No se registran contraseñas, tokens, cookies ni el client secret.
- Los eventos `LOGIN_SUCCEEDED`, `LOGIN_FAILED`, `LOGOUT`, `SESSION_EXPIRED`, `ACCESS_DENIED`, `AUTH_CHALLENGE_REQUIRED`, `AUTH_CHALLENGE_SUCCEEDED`, `AUTH_CHALLENGE_FAILED`, `TOKEN_REFRESH_SUCCEEDED` y `TOKEN_REFRESH_FAILED` salen como JSON en el logger. No hay tabla de auditoría.

## Documentación

- [Autenticación BFF](docs/architecture/autenticacion-bff.md)
- [Identidad y acceso](docs/architecture/identidad-y-acceso.md)
