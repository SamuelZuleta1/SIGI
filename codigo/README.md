# Código — SIGI

Aplicación web (Node.js + Express + EJS; base de datos, documentos y autenticación en Supabase).
Antes de programar: [docs/contexto/CONTEXTO_PROYECTO.md](../docs/contexto/CONTEXTO_PROYECTO.md)
y [docs/plan_desarrollo.md](../docs/plan_desarrollo.md).

## Requisitos

- Node.js 20 o superior
- Docker Desktop abierto
- Supabase CLI

## Puesta en marcha (local)

```bash
npm install
npm run db:start            # Supabase local: base de datos, Auth, Storage y Mailpit
cp .env.example .env        # completar con los valores de `supabase status`
npm run db:usuarios         # 10 usuarios de demostración @sigi.test
npm run dev                 # http://localhost:3000
```

- `npm run db:reset` vuelve a crear la base de datos (migraciones + `supabase/seed.sql`).
  Después hay que repetir `npm run db:usuarios`.
- Los correos que envía el sistema se ven en Mailpit: http://127.0.0.1:54324

## Pruebas

```bash
npm test            # unitarias y HTTP (sin red)
npm run test:int    # integración, contra Supabase local
```

## Estructura

```
codigo/
├── public/        css/ y js/
├── scripts/       crear-usuarios-demo.js
├── supabase/      config.toml, migrations/, seed.sql
├── src/           app.js, config/, middleware/, routes/, views/,
│                  controllers/, models/, persistence/, servicios/
└── tests/         unit/, http/, integracion/, helpers/
```
