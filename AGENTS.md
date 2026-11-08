# EnerCol backend

NestJS 12 application. It is ESM (`"type": "module"`): relative imports end in `.js`.

Tests run on Jest 30 with `node --experimental-vm-modules`, because NestJS 12 and the generated Prisma 7 client are ESM. Do not switch the project to CommonJS: the Prisma client uses `import.meta`.

TypeScript is pinned to 6.0.3. Prisma is pinned to 7.10.1.

Layers live inside each module (`domain`, `application`, `infrastructure`, `presentation`). Shared infrastructure holds Prisma. Identity and access lives in `src/modules/identity-access`. The BFF session flow lives in `src/modules/auth` and stores sessions in PostgreSQL; do not add a User table. `JwtAuthGuard` verifies the Cognito access token, from the BFF session cookie or a bearer token. `RolesGuard` then requires `@Roles(...)` or `@Authenticated()`; a protected route with neither is denied. `@Public()` skips both. Cognito groups `ESPECIALISTA_TECNICO` and `ESPECIALISTA_VALIDADOR` map to `SPECIALIST` and `VALIDATOR`; do not store users or roles in PostgreSQL.

The generated Prisma client in `src/generated` is not committed. Run `pnpm prisma:generate` after installing dependencies.
