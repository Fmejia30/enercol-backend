# EnerCol backend

API del sistema de análisis técnico y generación asistida de informes postventa. El acceso a los endpoints protegidos se valida con access tokens de Amazon Cognito.

## Requisitos

- Node.js 24.21.0 (mínimo 24.15.0 en la línea 24)
- pnpm 12.10.1
- Docker y Docker Compose, para PostgreSQL local

## Arranque local

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm prisma:generate
pnpm prisma:migrate
pnpm start:dev
```

- API: `http://localhost:3000/api/v1`
- Health check, público: `GET /api/v1/health`
- Identidad autenticada: `GET /api/v1/identity/me`
- OpenAPI, fuera de producción: `http://localhost:3000/api/swagger`

`GET /api/v1/health` responde 200 si PostgreSQL contesta y 503 si no. El proceso puede arrancar sin base de datos; la consulta ocurre al llamar el endpoint.

## Comprobaciones

```bash
pnpm test
pnpm test:e2e
pnpm lint
pnpm build
```

Las pruebas usan Jest. En Node.js 24 hay que arrancar Jest con `--experimental-vm-modules`, porque los paquetes de NestJS 12 y el cliente de Prisma 7 son ESM. Los scripts del `package.json` ya incluyen ese flag. La aplicación en ejecución no lo necesita.

## Identidad y acceso

Los endpoints están cerrados por defecto. `JwtAuthGuard` autentica el access token de Cognito. `RolesGuard` autoriza después, leyendo con `Reflector` lo que declara cada handler:

- `@Public()` omite autenticación y autorización.
- `@Roles(...)` exige una sesión BFF o un access token, y al menos uno de los roles indicados. Varios roles se evalúan con OR.
- `@Authenticated()` exige sesión o access token y no un rol concreto. Sirve para una ruta protegida que solo necesita la identidad.
- Una ruta sin `@Public()`, `@Roles()` ni `@Authenticated()` responde 403 cuando el token es válido. No queda abierta.

El navegador no envía el access token. `POST /api/v1/auth/login` recibe correo y contraseña, NestJS autentica contra Cognito y guarda la sesión. Un cliente que ya tiene un access token del mismo App Client puede enviarlo como `Authorization: Bearer`. El backend verifica firma, emisor, expiración, `token_use = access` y `client_id` con `aws-jwt-verify` y las claves JWKS del User Pool. El detalle del BFF está en `docs/architecture/autenticacion-bff.md`. No se acepta un ID token: `token_use` debe ser `access`. Un token ausente, inválido o expirado responde 401. Si una operación protegida no tiene usuario autenticado, la respuesta también es 401. Un token válido sin el rol requerido responde 403. La respuesta no incluye el token ni el detalle criptográfico. Un encabezado o un cuerpo no pueden asignar el rol.

Grupos de Cognito y roles internos:

| Grupo de Cognito         | Rol interno  | Nombre funcional       |
| ------------------------ | ------------ | ---------------------- |
| `ESPECIALISTA_TECNICO`   | `SPECIALIST` | Especialista técnico   |
| `ESPECIALISTA_VALIDADOR` | `VALIDATOR`  | Especialista validador |

Un usuario puede tener ambos roles. Los grupos no reconocidos se ignoran y no crean permisos. Un usuario autenticado sin roles reconocidos puede consultar `GET /api/v1/identity/me` y cualquier otra ruta `@Authenticated()`. Recibe 403 en las que exigen `@Roles()`. No hay tablas de usuarios ni de roles en PostgreSQL.

Un validador no puede validar un informe cuyo autor es él mismo. Esa restricción es una política de autorización sobre el recurso, no una regla de rol. Está expresada en `decideReportValidation` y la aplicará el módulo Review cuando exista. Si el autor no viene identificado, la decisión también es negativa. Este backend todavía no expone endpoints de informes.

MFA, el bloqueo tras cinco intentos fallidos y una sesión de 60 minutos siguen pendientes de aprobación por Seguridad. No están implementados ni se toman como política vigente.

El detalle de guards y decoradores está en `docs/architecture/identidad-y-acceso.md`.

`COGNITO_REGION`, `COGNITO_USER_POOL_ID` y `COGNITO_CLIENT_ID` son obligatorias al arrancar. Los valores de `.env.example` solo tienen el formato correcto; hay que reemplazarlos por el User Pool real antes de aceptar tokens de usuarios.

## Decisiones de esta etapa

- El proyecto es ESM. El cliente generado por Prisma 7.10.1 usa `import.meta` y no se puede compilar como CommonJS.
- TypeScript queda fijado en 6.0.3. La versión 7 todavía no la aceptan ESLint, ts-jest ni `@nestjs/swagger`.
- Prisma queda fijado en 7.10.1. El tag `latest` de Prisma es una release candidate de la versión 8.
- No hay modelos de dominio. La primera migración se creará con el primer agregado que tenga una historia de usuario.
- Las credenciales de `docker-compose.yml` y `.env.example` son solo de desarrollo local.

## Documentación

Los ADR y la documentación de arquitectura de este backend viven en `docs/`.
