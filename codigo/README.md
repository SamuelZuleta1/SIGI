# Código — SIGI

Aplicación web (Node.js + Express + EJS; base de datos, documentos y autenticación en Supabase).
Antes de programar: [docs/contexto/CONTEXTO_PROYECTO.md](../docs/contexto/CONTEXTO_PROYECTO.md)
y [docs/plan_desarrollo.md](../docs/plan_desarrollo.md).

## Requisitos

- Node.js 20 o superior
- Supabase CLI
- Acceso al proyecto de Supabase en la nube de SIGI

La base de datos, Auth y Storage viven en el proyecto de Supabase en la nube: la aplicación,
las pruebas de integración y las migraciones usan siempre ese proyecto, así que los datos
persisten entre equipos. No se usa Supabase en Docker.

## Puesta en marcha

```bash
npm install
cp .env.example .env        # URL y claves del proyecto (panel → Project Settings → API)
supabase link --project-ref <ref-del-proyecto>   # una sola vez por equipo
npm run db:migrar           # aplica las migraciones pendientes a la nube
npm run db:usuarios         # 10 usuarios de demostración @sigi.test (no duplica)
npm run dev                 # http://localhost:3000
```

- Los cambios de esquema van como migraciones nuevas en `supabase/migrations/`
  (`supabase migration new <nombre>`) y se aplican con `npm run db:migrar`.
  `npm run db:estado` compara las migraciones del repositorio con las de la nube.
- `supabase/seed.sql` (entidades) ya está cargado en la nube; si se crea un proyecto nuevo,
  se ejecuta una vez desde el editor SQL del panel.
- El correo sale por el servidor SMTP de `.env`. Si no hay uno, los registros se guardan igual
  y la pantalla avisa que no se pudo enviar el correo.

## Despliegue (Vercel)

SIGI se publica en Vercel; cada push a `main` despliega automáticamente.

- Proyecto `sigi`, con **Root Directory = `codigo`**. La app corre como una sola función serverless:
  `api/index.js` (monta la app con `src/arranque.js`) y `vercel.json` (rutas, archivos incluidos, 30 s).
- Variables de entorno en Vercel (Production): las de Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`), el SMTP (`SMTP_*`), las seis `CORREO_*` y `DEMO_PASSWORD`.
  Cambiarlas exige un Redeploy.
- Mailpit y `localhost` no existen en Vercel: el SMTP debe ser accesible desde internet.
- Límites del plan Hobby: unos 4,5 MB por petición y 10 s por función. Por eso los archivos (documentos, evidencias) no
  pasan por la función: el navegador pide a `POST /subidas` una URL firmada y los sube directo al bucket privado, en
  `pendientes/{usuario}/{uuid}`; el formulario solo envía la referencia (`subida_<campo>`). Al registrar, el servidor
  los descarga, comprueba tamaño (10 MB) y tipo por contenido, los guarda en su ruta definitiva y borra el pendiente.
  Sin JavaScript el formulario sigue enviando el archivo en la petición (solo cabe hasta ~4 MB).
  La CSP (`connect-src`) permite conectar al origen de `SUPABASE_URL`.
  Para **ver** un archivo (documento, evidencia), la ruta comprueba el permiso y responde `303` a una URL firmada de 60 s
  del bucket (DA-71): Vercel tampoco deja responder más de 4,5 MB desde la función.

## Pruebas

```bash
npm test            # unitarias y HTTP (sin red)
npm run test:int    # integración, contra el proyecto de Supabase en la nube
```

Las pruebas de integración crean sus propios datos y los borran al terminar.

## Limitaciones conocidas

- **Festivos:** la lista fija de `src/servicios/dias-habiles.js` cubre 2026 y 2027. Fuera de esos años
  solo se descuentan sábados y domingos, así que los plazos en días hábiles (alertas, faltantes,
  segundo llamado) pueden quedar más cortos. Hay que ampliar la lista cada año.
- **SMMLV:** `src/servicios/smmlv.js` tiene 2025 y 2026. Para otro año se usa el más cercano
  disponible y la advertencia del IBC dice cuál; también se actualiza cada año.

## Estructura

```
codigo/
├── public/        css/ y js/
├── api/           index.js (función de Vercel)
├── scripts/       crear-usuarios-demo.js
├── supabase/      config.toml, migrations/, seed.sql
├── src/           app.js, arranque.js, servidor.js, config/, middleware/, routes/, views/,
│                  controllers/, models/, persistence/, servicios/
└── tests/         unit/, http/, integracion/, helpers/
```
