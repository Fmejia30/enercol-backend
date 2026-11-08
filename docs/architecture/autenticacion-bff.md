# Autenticación BFF

NestJS es el único cliente de Cognito que ve el navegador. React enviará correo y contraseña a este backend y no recibirá ni guardará tokens de Cognito. Cognito sigue siendo el dueño de las credenciales, del usuario y de los grupos.

El flujo es `USER_PASSWORD_AUTH` con el App Client confidencial. No usa Hosted UI, Authorization Code, PKCE ni `AdminInitiateAuth`.

## Responsabilidades

|                         | Cognito | NestJS                                                                                            |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| Contraseña y desafíos   | Sí      | Los recibe, los envía a Cognito y no los guarda                                                   |
| Grupos                  | Sí      | Solo los lee del access token ya verificado                                                       |
| Emisión de tokens       | Sí      | Los guarda cifrados y no los devuelve                                                             |
| Sesión de la aplicación | No      | Cookie opaca y fila en PostgreSQL                                                                 |
| Roles internos          | No      | El mapeo existente: `ESPECIALISTA_TECNICO` → `SPECIALIST`, `ESPECIALISTA_VALIDADOR` → `VALIDATOR` |

Hay un solo App Client, con secreto. El verificador de access tokens acepta únicamente el `client_id` de ese cliente. Un bearer de otro cliente, incluido el que se usó antes en Postman, no autentica.

## Flujo

1. `POST /api/v1/auth/login` recibe `email` y `password`. Valida el origen, aplica un límite por proceso y llama a `InitiateAuth` con `USER_PASSWORD_AUTH` y `SECRET_HASH`.
2. Si Cognito devuelve tokens, el backend verifica el access token y el ID token, crea la sesión, cifra los tokens y entrega la cookie `HttpOnly`. La respuesta trae el usuario y el token CSRF, nunca los tokens de Cognito.
3. Si Cognito devuelve un desafío soportado, el backend guarda el `Session` cifrado, con un identificador opaco de un solo uso y cinco minutos de vigencia. El navegador recibe ese identificador y el nombre del desafío, no el `Session`.
4. `POST /api/v1/auth/challenge` consume ese identificador y responde a Cognito con el tipo que quedó guardado. El cliente no puede elegir otro `ChallengeName`.
5. `GET /api/v1/auth/session` lee la cookie. No crea una sesión. Si no es válida responde `{ "authenticated": false }`.
6. `POST /api/v1/auth/logout` exige el origen del frontend y, si hay cookie, el encabezado `X-CSRF-Token`. Revoca el refresh token con `RevokeToken`, invalida la fila local aunque Cognito no responda y borra las cookies.

`SECRET_HASH` es `Base64(HMAC_SHA256(clientSecret, username + clientId))`.

## Desafíos

Se aceptan `NEW_PASSWORD_REQUIRED`, `SMS_MFA`, `SOFTWARE_TOKEN_MFA`, `EMAIL_OTP` y `MFA_SETUP`. En `NEW_PASSWORD_REQUIRED` solo se reenvían la contraseña nueva y los atributos que Cognito marcó como requeridos. En `MFA_SETUP` el backend asocia el token de software, entrega el secreto TOTP una vez y luego verifica el código. Un desafío no implementado se rechaza sin reenviar el cuerpo del cliente.

Una contraseña incorrecta, un usuario inexistente, una cuenta no confirmada o un desafío fallido responden `401` con el mismo mensaje. El límite local es de 10 intentos por dirección en 10 minutos para login y desafíos. Es un control del proceso, no el bloqueo de cuenta pendiente de Seguridad.

## Cookies

| Cookie               | Contenido           | HttpOnly | SameSite           | Secure          |
| -------------------- | ------------------- | -------- | ------------------ | --------------- |
| `COOKIE_NAME`        | Identificador opaco | Sí       | `COOKIE_SAME_SITE` | `COOKIE_SECURE` |
| `{COOKIE_NAME}_csrf` | Token CSRF          | No       | `COOKIE_SAME_SITE` | `COOKIE_SECURE` |

`Path=/`. La vigencia de la cookie coincide con la expiración absoluta de la sesión. En PostgreSQL solo se guarda el hash SHA-256 del identificador y del token CSRF. El valor recuperable del CSRF se guarda cifrado para poder devolverlo en `GET /api/v1/auth/session`.

`SameSite=None` exige `COOKIE_SECURE=true`. CORS usa `credentials: true` y nunca `*`. En `NODE_ENV=development` refleja el `Origin` recibido y acepta clientes sin ese encabezado, como Postman. En cualquier otro entorno, incluido producción, solo refleja `FRONTEND_ORIGIN`. El login y el desafío exigen ese origen; el logout sin `Origin` solo continúa si hay cookie de sesión y el CSRF se valida después.

## Sesión y desafíos

`AuthSession` guarda el `sub`, el email leído del ID token, el access token y el refresh token cifrados, la expiración absoluta, la última actividad y la revocación. El ID token no se persiste. `AuthChallenge` guarda el hash del identificador, el usuario de Cognito cuando viene en el desafío, el tipo, el `Session` cifrado, la expiración y el momento de consumo.

El cifrado es AES-256-GCM. La clave sale de `SESSION_ENCRYPTION_KEY`, 32 bytes en base64. En desarrollo se genera con `openssl rand -base64 32` y se pone en `.env`, que no se versiona. En producción la misma variable debe salir de un gestor de secretos.

La expiración absoluta y la inactividad salen de `SESSION_ABSOLUTE_TTL_SECONDS` y `SESSION_IDLE_TTL_SECONDS`. Los valores por defecto, 8 horas y 30 minutos, son una configuración operativa. La sesión de 60 minutos sigue pendiente de aprobación por Seguridad.

## Renovación de tokens

No hay un endpoint `/auth/refresh`. Cada solicitud que usa la cookie —`GET /api/v1/auth/session` y cualquier ruta protegida— carga la sesión y revisa `accessTokenExpiresAt`. Si faltan 5 minutos o menos, y la sesión sigue dentro de `SESSION_ABSOLUTE_TTL_SECONDS` y `SESSION_IDLE_TTL_SECONDS`, el backend llama a `GetTokensFromRefreshToken`. No usa `REFRESH_TOKEN_AUTH`.

La cookie y el identificador de sesión no cambian. Solo se reemplazan los tokens cifrados y la fecha de vencimiento del access token. `expiresAt` de la sesión local no se mueve.

La fila se lee y se actualiza dentro de una transacción con `SELECT … FOR UPDATE`. La segunda petición de la misma sesión espera ese bloqueo. Cuando entra, ve los tokens ya rotados y no vuelve a llamar a Cognito. El bloqueo cubre la llamada a Cognito porque la rotación invalida el refresh token anterior.

Si Cognito rechaza el refresh token, o la rotación no devuelve uno nuevo, la sesión queda revocada y la petición responde sin autenticación. Hace falta volver a iniciar sesión. Si Cognito no responde, la fila no se revoca: el refresh token anterior sigue siendo usable cuando el proveedor vuelva.

## Endpoints

| Método | Ruta                     | Resultado                                                                                            |
| ------ | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/auth/login`     | 200 con sesión o desafío; 401 genérico; 403 si el origen no coincide; 429 si hay demasiados intentos |
| POST   | `/api/v1/auth/challenge` | El mismo contrato, usando el identificador opaco                                                     |
| GET    | `/api/v1/auth/session`   | 200 con `authenticated` y, si hay sesión, `user` y `csrfToken`                                       |
| POST   | `/api/v1/auth/logout`    | 204; 403 si falla el origen o el CSRF                                                                |

`POST /api/v1/auth/login` recibe `{ "email", "password" }`. Una sesión exitosa responde `{ "authenticated": true, "csrfToken", "user": { "id", "email", "roles" } }` y fija las cookies. Un desafío responde `{ "authenticated": false, "challenge": { "id", "name", "requiredAttributes", "secretCode?" } }`.

`POST /api/v1/auth/challenge` recibe `{ "challengeId", "code?", "newPassword?", "attributes?" }`.

Los eventos `LOGIN_SUCCEEDED`, `LOGIN_FAILED`, `LOGOUT`, `SESSION_EXPIRED`, `ACCESS_DENIED`, `AUTH_CHALLENGE_REQUIRED`, `AUTH_CHALLENGE_SUCCEEDED`, `AUTH_CHALLENGE_FAILED`, `TOKEN_REFRESH_SUCCEEDED` y `TOKEN_REFRESH_FAILED` salen como JSON en el logger. No incluyen contraseñas, códigos, cookies ni tokens. No hay tabla de auditoría. La integración con CloudWatch queda para ENER-107.

## Cognito

En el User Pool que ya está configurado:

1. El App Client confidencial debe tener `ALLOW_USER_PASSWORD_AUTH` y la rotación de refresh tokens.
2. `ALLOW_REFRESH_TOKEN_AUTH` permanece deshabilitado. La renovación usa `GetTokensFromRefreshToken`.
3. El identificador de inicio de sesión es el correo.
4. `COGNITO_ISSUER` y `COGNITO_JWKS_URI` tienen que ser los del mismo User Pool. El verificador usa las claves JWKS de ese emisor.
5. MFA no es obligatorio. Si el pool devuelve `SMS_MFA`, `SOFTWARE_TOKEN_MFA`, `EMAIL_OTP` o `MFA_SETUP`, el backend ya puede continuar el desafío. Habilitar esos métodos en el pool es una decisión de Cognito, no de esta API.
6. No hace falta Hosted UI, callback ni sign-out URL para este flujo.

## Ejecución local

```bash
pnpm install
cp .env.example .env
# completar el client secret y SESSION_ENCRYPTION_KEY
pnpm prisma:generate
pnpm prisma:migrate
pnpm start:dev
```

La migración `20261108080000_auth_password_challenge` elimina `auth_transaction` y crea `auth_challenge`. No modifica la migración anterior.

## Pendiente para producción

- Aprobar con Seguridad la duración de sesión, MFA obligatorio y el bloqueo tras cinco intentos. El límite de este proceso no sustituye esa política.
- Definir el dominio real del frontend y del API antes de usar `SameSite=None`.
- Entregar `SESSION_ENCRYPTION_KEY` y `COGNITO_CLIENT_SECRET` desde un gestor de secretos.
- Activar `COOKIE_SECURE=true`.
- Confiar en el proxy solo si el proceso queda detrás de un balanceador, para que la IP de auditoría sea la del cliente.
- Programar la limpieza de sesiones y desafíos vencidos. El login solo borra desafíos ya expirados.
- Conectar los eventos JSON a CloudWatch en ENER-107.
- El frontend React queda fuera de esta actividad.
