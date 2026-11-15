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
| `SEED_SPECIALIST_SUB` | Sub de Cognito del especialista al que se asignan los dos casos de demostración. Lo usa la semilla, no el arranque de NestJS |
| `SEED_DATABASE_HOST` | Hostname permitido para sembrar cuando la base no es local. Vacío en local |
| `MONGODB_URI` | Conexión de la bóveda de tokens. Vacía hasta usar privacidad. Si se define, `PRIVACY_ENCRYPTION_KEY` también |
| `MONGODB_DB_NAME` | Base de esa bóveda. Por defecto `enercol_privacy` |
| `PRIVACY_ENCRYPTION_KEY` | Clave de 32 bytes en Base64 para AES-256-GCM de los valores originales. No es la clave de sesión. En local: `openssl rand -base64 32` |
| `OPENAI_API_KEY` | Clave de la API de OpenAI. Solo la usa el backend. Vacía hasta generar informes. No se envía al frontend |
| `OPENAI_MODEL` | Modelo de generación. Por defecto `gpt-6-luna` |
| `OPENAI_REASONING_EFFORT` | `none`, `low`, `medium`, `high`, `xhigh` o `max`. Por defecto `low` |
| `OPENAI_MAX_OUTPUT_TOKENS` | Tope de tokens de salida, entre 16 y 128000. Por defecto `6000` |

## Ejecución, migraciones y pruebas

| Comando | Acción |
| --- | --- |
| `pnpm start:dev` | Arranque con recarga |
| `pnpm start:debug` | Arranque con inspector y recarga |
| `pnpm build` | Genera el cliente Prisma y compila a `dist/` |
| `pnpm start:prod` | Ejecuta `node dist/main`. No migra ni siembra |
| `pnpm prisma:migrate` | `prisma migrate dev` para desarrollo local |
| `pnpm prisma:seed` | Genera el cliente Prisma y siembra o refresca los dos casos técnicos |
| `pnpm deploy` | Instala, migra, siembra, compila y arranca. Se detiene si un paso falla |
| `pnpm test` | Pruebas unitarias |
| `pnpm test:e2e` | Pruebas de extremo a extremo |
| `pnpm test:cov` | Cobertura |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |

Jest se ejecuta con `node --experimental-vm-modules` porque NestJS 12 y el cliente de Prisma son ESM. Los scripts ya incluyen el flag. El proceso de la API no lo necesita.

Las pruebas unitarias y e2e no llaman a Cognito ni exigen una base en ejecución: el acceso a datos se sustituye. `pnpm prisma:migrate` sí necesita PostgreSQL local.

## Despliegue

`pnpm deploy` ejecuta, en este orden:

```bash
pnpm install --frozen-lockfile
pnpm exec prisma migrate deploy
pnpm prisma:seed
pnpm build
pnpm start:prod
```

`pnpm prisma:seed` genera el cliente antes de sembrar, porque la semilla ocurre antes de la compilación. NestJS no migra ni siembra al arrancar. Si la instalación, la migración o la semilla fallan, el proceso termina y `pnpm start:prod` no se ejecuta.

La semilla sigue disponible por separado con `pnpm prisma:seed`. Repetirla actualiza los dos casos y vuelve a escribir la telemetría, el consumo del periodo de evaluación y el consumo histórico.

`SEED_SPECIALIST_SUB` debe ser el sub de Cognito configurado por quien opera el repositorio. Si falta o no tiene formato de sub, la semilla termina con error. En local, `DATABASE_URL` debe apuntar a `localhost` o `127.0.0.1`. Para la base de demostración en otro host, incluido un despliegue con `NODE_ENV=production`, `SEED_DATABASE_HOST` debe ser exactamente ese hostname. Cualquier otro host se rechaza, sin imprimir la cadena de conexión.

## Solicitudes postventa

PostgreSQL es la fuente de las solicitudes. El modelo `PostSaleRequest` se guarda en `post_sale_request`. El identificador es un UUID de texto, `ticket_code` es único y los periodos de evaluación son `DATE`. `created_at` y `updated_at` son `TIMESTAMP(3)` en UTC. `assigned_specialist_sub` es opcional y, cuando existe, guarda el `sub` de Cognito del especialista asignado. No hay conceptos Norte/Sur ni tabla de usuarios. La tabla puede empezar vacía.

`post_sale_request_ticket` solo guarda el consecutivo del ticket. El primer valor persistido produce `PV-000001`. El incremento ocurre en la base, así que dos registros simultáneos no reciben el mismo código.

La migración `prisma/migrations/20261114213000_optional_post_sale_assignment` hace opcional la asignación y crea ese consecutivo. En desarrollo local se aplica con `pnpm prisma:migrate`. El despliegue usa `prisma migrate deploy` y no corre al arrancar la API.

`POST /api/v1/post-sale-requests` lo pueden llamar `SPECIALIST` y `ADMINISTRATOR`. El cuerpo acepta cliente, instalación, activo opcional, tipo, descripción y periodo. El servidor genera el id, el ticket, el estado `ABIERTA` y las fechas. La solicitud queda sin especialista asignado. Un `VALIDATOR` recibe 403. Campos como `status`, `ticketCode` o `assignedSpecialistSub` se rechazan.

`GET /api/v1/post-sale-requests` busca por ticket, cliente o instalación sin distinguir mayúsculas. La búsqueda sí distingue tildes. El orden es `createdAt` descendente y, en empate, `id` descendente. `SPECIALIST` y `VALIDATOR` solo ven solicitudes asignadas a su propio `sub`. Una solicitud sin asignación solo la ve `ADMINISTRATOR`.

`GET /api/v1/post-sale-requests/:id` devuelve el especialista asignado como `assignedSpecialist` con `firstName` y `lastName`. No incluye el sub de Cognito. Si no hay asignación, el objeto es nulo. Si hay asignación y el perfil no tiene nombre, los campos de nombre quedan nulos.

`GET /api/v1/post-sale-requests/:id/technical-data` devuelve el conjunto técnico de una solicitud visible: umbral contractual de demanda en kW, consumo del periodo de evaluación en kWh, unidades, origen, lecturas de demanda dentro de ese periodo y consumos históricos cuyo último día es anterior al inicio del periodo. Un caso que no compara demanda deja el umbral en nulo. Un caso que no compara consumo deja el consumo del periodo en nulo. El mes evaluado no se mezcla con el histórico. No ejecuta análisis ni emite un informe. Si la solicitud no es visible, responde el mismo 404 del detalle.

`POST /api/v1/post-sale-requests/:id/analyses` ejecuta el análisis determinista y persiste una ejecución nueva. El cuerpo debe ir vacío: el cliente no envía hallazgos. `GET /api/v1/post-sale-requests/:id/analyses` lista las ejecuciones de la más reciente a la más antigua. Los instantes se devuelven en UTC. Las fechas de periodo siguen siendo fechas calendario. `SPECIALIST` y `ADMINISTRATOR` pueden ejecutar cuando la solicitud les es visible. `VALIDATOR` puede consultar, no ejecutar. Una ejecución con datos inconsistentes queda en `FAILED` y no inventa hallazgos.

`POST /api/v1/post-sale-requests/:id/reports` genera un borrador con el análisis exitoso más reciente. El cuerpo va vacío. `GET /api/v1/post-sale-requests/:id/reports` lista las versiones, `GET /api/v1/post-sale-requests/:id/reports/:reportId` lee una y `GET /api/v1/post-sale-requests/:id/reports/:reportId/versions` devuelve el historial de esa solicitud. Cada generación inserta una versión nueva en estado `DRAFT`. `SPECIALIST` y `ADMINISTRATOR` pueden generarlo. `VALIDATOR` puede leerlo y no puede generarlo ni aprobarlo.

## Casos técnicos de prueba

`pnpm prisma:seed` inserta o actualiza dos solicitudes `PostSaleRequest` (`PV-A05-001` y `PV-A05-002`) y su conjunto técnico en PostgreSQL. Es idempotente. Exige `SEED_SPECIALIST_SUB` con el sub real de Cognito del especialista. No inventa sujetos. Los casos quedan asignados solo a ese especialista.

Los casos quedan asignados a ese especialista, en estado `ABIERTA`. El origen queda marcado como `local-controlled-dataset`. Los tickets `PV-A05-*` no consumen el consecutivo `PV-000001`. Los identificadores de solicitud y de conjunto no cambian al repetir la semilla.

`PV-A05-001` (`VERIFICACION_DEMANDA`, Textiles del Altiplano, 2026-09-01 a 2026-09-07) compara demanda medida en kW con el umbral contractual almacenado de `250.000` kW. Las lecturas del 2026-09-03 son `210.000`, `248.500`, `267.250` y `241.000` kW. Solo `267.250` supera el umbral. No guarda consumo del periodo de evaluación. Julio y agosto quedan como contexto histórico y terminan antes del 2026-09-01.

`PV-A05-002` (`CONSUMO_ATIPICO`, Alimentos Río Claro, 2026-09-01 a 2026-09-30) compara energía en kWh. El consumo del periodo evaluado es `124800.000` kWh. El histórico son junio `98000.000`, julio `101250.000` y agosto `99500.750` kWh. Cada mes histórico termina antes del 2026-09-01, así que no se solapa con septiembre. El valor de septiembre es mayor que cada mes previo para que una comparación posterior pueda observar el aumento. Ese valor es un dato de demostración: el conjunto no guarda un umbral contractual de consumo ni un porcentaje de desviación, y no define una regla regulatoria. Este caso no tiene lecturas de demanda en kW ni umbral de demanda.

## Privacidad

El módulo interno de privacidad prepara una copia protegida para un procesamiento externo futuro. No tiene endpoints públicos. PostgreSQL sigue guardando las solicitudes, los conjuntos técnicos y el análisis determinista sin cambios. MongoDB solo persiste el contexto de privacidad y los mapeos de token.

Cada mapeo guarda el token, la categoría, el contexto y el valor original cifrado con AES-256-GCM. La clave sale de `PRIVACY_ENCRYPTION_KEY` y no se escribe en MongoDB. Esa variable debe contener 32 bytes codificados en Base64. En local se genera con:

```bash
openssl rand -base64 32
```

El token es aleatorio. Un token de un contexto no se resuelve en otro, y la resolución exige que la solicitud de ese contexto sea visible para quien la pide.

MongoDB tiene que estar disponible antes de ejecutar una operación de privacidad. La primera operación abre la conexión y crea la base `MONGODB_DB_NAME`, las colecciones `privacy_contexts` y `privacy_token_mappings`, y sus índices únicos. `pnpm deploy` no instala ni inicia MongoDB. Cada entorno de despliegue debe definir `MONGODB_URI`, `MONGODB_DB_NAME` y `PRIVACY_ENCRYPTION_KEY`.

Sin esas variables, o si la conexión o el cifrado fallan, la API sigue arrancando y la operación de privacidad termina sin devolver un payload. Las dos variables de conexión y clave, cuando se usan, deben definirse juntas.

## Informes borrador

La generación del informe vive en el mismo backend. Arma el payload con el módulo de privacidad, lo valida y solo entonces llama a la API de Responses de OpenAI. La respuesta se valida, se detokeniza con el mismo contexto y se guarda en PostgreSQL. Si cualquiera de esos pasos falla, no se inserta un informe.

El modelo, el esfuerzo de razonamiento y el máximo de tokens de salida salen de las variables de entorno. No hay reintentos automáticos. Una generación en curso para la misma solicitud rechaza una segunda petición. Cada generación exitosa crea la siguiente versión y no reescribe la anterior. El registro guarda el modelo y, cuando OpenAI los devuelve, los tokens de entrada y de salida. No guarda el prompt ni los valores originales.

Sin `OPENAI_API_KEY`, o si el proveedor no responde, la generación responde un error y no incluye la clave ni el payload. El informe queda en `DRAFT`. No hay aprobación formal.

`POST /api/v1/post-sale-requests/:id/reports/:reportId/revisions` guarda una edición como una versión nueva. No llama a OpenAI. Exige `baseVersion` igual a la versión más reciente y rechaza el cambio si los valores deterministas no coinciden con el análisis de esa versión. La versión anterior permanece. El cuerpo de generación, `POST /api/v1/post-sale-requests/:id/reports` con cuerpo vacío, no cambia.

`GET /api/v1/technical-reports` y `GET /api/v1/technical-analyses` listan lo que el usuario ya puede ver en sus solicitudes. No crean registros. Las respuestas de informe incluyen `origin` (`AI` o `MANUAL`) además de los campos anteriores.

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
