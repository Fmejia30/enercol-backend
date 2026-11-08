# Identidad y acceso

Amazon Cognito es la fuente de verdad de la identidad y de los grupos. PostgreSQL no guarda usuarios ni roles.

## Roles internos

| Grupo en `cognito:groups` | Rol interno  | Uso                                    |
| ------------------------- | ------------ | -------------------------------------- |
| `ESPECIALISTA_TECNICO`    | `SPECIALIST` | Elabora el análisis técnico            |
| `ESPECIALISTA_VALIDADOR`  | `VALIDATOR`  | Revisa el trabajo de otro especialista |

`mapCognitoGroupsToRoles` solo reconoce esos dos grupos. Un grupo desconocido se descarta. Si el claim no es una lista de cadenas, el usuario queda autenticado sin roles. Un mismo token puede traer los dos grupos; el resultado conserva `SPECIALIST` y `VALIDATOR`, en ese orden, sin duplicados.

Los roles se leen del access token ya verificado. Un header, un query param o el cuerpo de la petición no pueden otorgarlos.

## Autenticación

`JwtAuthGuard` es el guard de autenticación. Si la petición trae la cookie de sesión del BFF, resuelve esa sesión y valida el access token guardado en el servidor. Si no hay cookie, acepta `Authorization: Bearer`. Una cookie de sesión inválida no se sustituye por un bearer. El guard deja el `AuthenticatedUser` en la petición y no autoriza roles. El flujo del navegador está en `docs/architecture/autenticacion-bff.md`.

El verificador comprueba la firma con las JWKS del User Pool, el issuer, la expiración, `token_use = access` y `client_id`. No usa `aud` para aceptar un access token. Un ID token no sirve para autorizar.

Si no hay `Authorization: Bearer`, o la verificación falla, la respuesta es 401. El cuerpo no incluye el token ni la causa criptográfica. El proceso registra la etapa y el tipo de excepción, sin el JWT.

`@CurrentUser()` lee el usuario que dejó el guard. No vuelve a interpretar el token.

## Autorización

`RolesGuard` corre después de `JwtAuthGuard`. Usa `Reflector` para leer el requisito declarado en el handler o, si el handler no lo declara, en la clase. El requisito del handler reemplaza al de la clase.

| Declaración                   | Efecto                                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| `@Public()`                   | No pide token ni rol. También lo respeta `JwtAuthGuard`.         |
| `@Roles(UserRole.SPECIALIST)` | Exige ese rol. Con varios argumentos basta uno.                  |
| `@Authenticated()`            | Exige un usuario autenticado, aunque no tenga un rol reconocido. |
| Ninguna                       | 403 si el usuario ya está autenticado. La ruta no queda abierta. |

Si la operación protegida no tiene `request.user`, `RolesGuard` responde 401. No convierte esa ausencia en 403. Un token válido sin el rol exigido sigue respondiendo 403.

Un usuario sin roles reconocidos puede consultar `GET /api/v1/identity/me`, declarado con `@Authenticated()`. Recibe 403 en una ruta `@Roles()`.

Ejemplo de declaración. No añade endpoints de informes:

```typescript
@Get('me')
@Authenticated()
me(@CurrentUser() user: AuthenticatedUser) {
  return { userId: user.userId, roles: [...user.roles] };
}

@Roles(UserRole.VALIDATOR)
review(@CurrentUser() user: AuthenticatedUser) {
  return user.userId;
}
```

## Auto-validación

Un validador no puede validar un informe del que es autor. Es una política sobre el recurso, no un rol adicional. `decideReportValidation` la expresa: sin rol `VALIDATOR` niega, sin autor identificado niega, y si el autor es el mismo usuario niega. El módulo Review la aplicará cuando exista. Esta historia no crea endpoints de informes.

## Pendiente de aprobación por Seguridad

Estas medidas no están implementadas y no son política vigente:

- MFA.
- Bloqueo después de cinco intentos fallidos.
- Duración de sesión de 60 minutos.
