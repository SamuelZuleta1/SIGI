# Plan de desarrollo — SIGI

> Fase 2. Fecha: 2026-11-16. Estado: **pendiente de aprobación.**
> Base: `docs/contexto/CONTEXTO_PROYECTO.md`, F1 (PDF de la Segunda Entrega), `docs/auditoria/` (hallazgos H-xx y decisiones DA-xx).
> Las decisiones técnicas que **no** salen de la documentación están marcadas como **[NUEVA]** y se resumen en la §8 para que las apruebes.

---

## 1. Stack y arquitectura

El stack y la arquitectura **ya están aprobados en la documentación** (F1 §2.6, §9, §10, §11). No propongo cambiarlos; solo agrego las herramientas de desarrollo y pruebas.

| Pieza | Elección | Justificación (fuente) |
| --- | --- | --- |
| Servidor web | Node.js (v26 instalada) + Express | F1 §2.6, CMP-01, DEP-01 |
| Vistas | Plantillas EJS generadas en el servidor | F1 §11.1 |
| Base de datos | Supabase PostgreSQL (13 tablas del Modelo + `usuario`) | F1 §2.6, CMP-01; DA-02 |
| Documentos | Supabase Storage, bucket **privado**; solo el servidor accede | F1 §2.6, RNF-03, HU-02 |
| Autenticación | Supabase Auth (correo + contraseña) | HU-01, Visión §5.3 |
| Correo | SMTP con `nodemailer`. En desarrollo y demostración, **Mailpit** (el que trae Supabase local, bandeja en `localhost:54324`) | F1 §2.6; DA-02 (e) |
| Acceso a datos | `@supabase/supabase-js` con la clave *service role*, **solo en el servidor** | F1 §2.6 («nunca el navegador») |
| Pruebas | **[NUEVA]** Vitest + Supertest; Supabase local (CLI 2.109 + Docker, ya instalados) para las pruebas de integración | §6 |
| Validación de entradas | **[NUEVA]** `zod` en los controladores | Tipos de dato no definidos en el diseño (F1 §6.3) |

**Capas (MVC + Persistencia, una clase por capa, 14 grupos):**

```
Navegador ──HTTPS──► routes/<grupo>.routes.js
                       │  middleware: autenticacion.js (sesión + rol + epicrisis)
                       ▼
                     controllers/<grupo>.controller.js   ← «Control de incapacidades» (42 op.)
                       │            └── servicios/correo.js (13 notificaciones)
                       ▼
                     persistence/<grupo>.persistence.js  ← «Base de datos» (38 op.)
                       │            └── almacen-documentos.js (Storage)
                       ▼
                     Supabase (PostgreSQL, Storage, Auth)
views/<grupo>/*.ejs  ← «Interfaz de incapacidades» (31 op. + ver documento DA-06)
```

**Módulos justificados con su CU / requisito:**

| # | Módulo | Grupo(s) | CU | CAR / RNF | HU |
| --- | --- | --- | --- | --- | --- |
| 0 | Base del proyecto | — | — | RNF-01…06 | — |
| 1 | Acceso y seguridad | `middleware/autenticacion.js` | — (Visión §5.3) | CAR-11, RNF-02/03 | HU-01, 02 |
| 2 | Registro y recepción | `registro`, `reemplazo` | CU-01, 02, 03 | CAR-01, 10 | HU-03, 04, 05 |
| 3 | Verificación documental | `verificacion` | CU-04, 05 | CAR-02, 10, 11 | HU-06, 07, 08 (+ ver documento de HU-02) |
| 4 | Radicación | `radicacion` | CU-06 (CU-07 fuera) | CAR-04 | HU-09, 10 |
| 5 | Estados y alertas | `estados`, `alertas` | CU-08, 09 | CAR-03, 04 | HU-11, 12 |
| 6 | Cobro | `cobro` | CU-10 | CAR-04, 05 | HU-13, 14, 15 |
| 7 | Seguimiento y escalamiento | `seguimiento`, `cobro-juridico` | CU-11, 12 | CAR-05 | HU-16 a 20 |
| 8 | Reconocimiento económico | `reconocimiento` | CU-13 | CAR-06 | HU-21 |
| 9 | Incapacidades prolongadas | `monitoreo` | CU-14 | CAR-07 | HU-22, 23, 24 |
| 10 | Conciliación contable | `conciliacion` | CU-15 | CAR-08 | HU-25, 26 |
| 11 | Reportes | `reportes` | CU-16 | CAR-09 | HU-27, 28 |
| 12 | Archivo | `archivo` | CU-17 | CAR-10, 11 | HU-29, 30 |

---

## 2. Backlog ordenado

Orden: por dependencias (F3 §15) y luego por prioridad. Se respeta el orden de módulos 1→12 del plan del equipo. Cada tarea cierra con los tests de sus criterios (§6). Commits: `feat(HU-xx): …`; para la base, `chore(base): …`.

| Orden | Tarea | HU | CU / DS | Decisiones | Depende de | Prior. |
| --- | --- | --- | --- | --- | --- | --- |
| T-00a | Proyecto Express + EJS, estructura de carpetas (§3), `layout.ejs`, `.env.example`, Vitest | — | — | — | — | Base |
| T-00b | Supabase local; migración con las 14 tablas (§4); RLS activado sin políticas; bucket privado `documentos` | — | CL-01 | DA-02, 04, 10, 11, 13, 21, 23 | T-00a | Base |
| T-00c | Seed: 7 entidades con sus plazos (§5.2.1); 10 usuarios de demostración `@sigi.test` con su rol | — | — | DA-02, DA-03 | T-00b | Base |
| T-00d | `servicios/correo.js` (nodemailer → Mailpit) con las 13 plantillas de notificación | — | F1 §6.4.4 | DA-02 (e), DA-12 | T-00a | Base |
| T-01 | Inicio y cierre de sesión; middleware que rechaza peticiones sin sesión | HU-01 | Visión §5.3 | DA-02 | T-00c | Alta |
| T-02 | Rol del usuario en la sesión; permisos por operación; restricción de historia clínica y epicrisis | HU-02 | CAR-11 | DA-02, DA-06 | T-01 | Alta |
| T-03 | Registrar incapacidad (receptor / auxiliar), con alta del colaborador si no existe | HU-03 | CU-01 / DS-01 | DA-03, DA-04, DA-23 | T-02 | Alta |
| T-04 | Registrar documentos (subida a Storage), aviso al auxiliar y original pendiente | HU-04 | CU-02 / DS-01 | DA-06 | T-03 | Alta |
| T-05 | Registrar reemplazo (máximo uno; un segundo registro reemplaza al anterior) | HU-05 | CU-03 / DS-02 | DA-22 | T-03 | Baja |
| T-06 | Verificar documentación (reglas por tipo de caso), archivo digital y **ver documento** | HU-06 (+HU-02 crit. 1–2) | CU-04 / DS-03 | DA-06 | T-04 | Alta |
| T-07 | Notificar faltantes (guarda `fecha_aviso_faltantes`; correo al colaborador) | HU-07 | CU-05 / DS-03 | DA-04, DA-13 | T-06 | Alta |
| T-08 | Registrar el segundo llamado (manual) y avisar a la Coordinación | HU-08 | CU-05 A1 / DS-03 | DA-07 | T-07 | Media |
| T-09 | Preparar la radicación: plazo, «al día / por vencer / vencido», canal digital o correo; advertir sin bloquear | HU-09 | CU-06 / DS-04 | DA-13, 14, 17 | T-03 | Alta |
| T-10 | Registrar la radicación y poner `estado = transcrita` | HU-10 | CU-06 / DS-04 | DA-01 | T-09 | Alta |
| T-11 | Consultar estados con filtros | HU-11 | CU-08 / DS-05 | DA-20 | T-10 | Alta |
| T-12 | Alertas de los 8 tipos de plazo, con días hábiles y festivos | HU-12 | CU-09 / DS-14 | DA-07, DA-13, DA-22 | T-07, T-10 | Alta |
| T-13 | Registrar la incapacidad como cobrada | HU-13 | CU-10 / DS-06 | — | T-10 | Alta |
| T-14 | Registrar el rechazo (y volver a transcrita con una nueva radicación) | HU-14 | CU-10 A2 / DS-06 | DA-01, DA-05 | T-10 | Alta |
| T-15 | Registrar el pago (operación compartida del grupo `cobro`) | HU-15 | CU-10 A1 / DS-06 | DA-08, DA-16 | T-13 | Alta |
| T-16 | Seguimiento semanal: pendientes (sin las dadas de baja), seguimiento y evaluar demora | HU-16 | CU-11 / DS-07 | DA-18 | T-15 | Media |
| T-17 | Aviso de retraso a la Coordinación y registro del acuerdo | HU-17 | CU-11 A2 / DS-07 | — | T-16 | Media |
| T-18 | Requerimientos de cobro persuasivo (solo cobradas) | HU-18 | CU-12 / DS-08 | DA-05, DA-14 | T-16 | Media |
| T-19 | Traslado a Cartera y Jurídica (advierte si hay menos de 2 requerimientos) | HU-19 | CU-12 / DS-08 | DA-14 | T-18 | Media |
| T-20 | Registrar la decisión de Cartera y Jurídica | HU-20 | CU-12 A1 / DS-08 | DA-02, DA-18 | T-19 | Baja |
| T-21 | Calcular el reconocimiento económico (tramos y trámite de pensión) | HU-21 | CU-13 / DS-09 | DA-09, DA-10 | T-03 | Media |
| T-22 | Consultar prolongadas (en vivo) y registrar el concepto | HU-22 | CU-14 / DS-10 | DA-19, DA-04 | T-03 | Media |
| T-23 | Registrar la falta del concepto | HU-23 | CU-14 A1 / DS-10 | DA-15 | T-22 | Media |
| T-24 | Registrar la suspensión del pago (>180 días) | HU-24 | CU-14 A2 / DS-10 | — | T-22 | Media |
| T-25 | Registrar los pagos consignados (Contabilidad) | HU-25 | CU-15 / DS-11 | DA-02 | T-15 | Media |
| T-26 | Identificar pagos y conciliar; marcar `pago.conciliado` | HU-26 | CU-15 / DS-11 | DA-11 | T-25 | Media |
| T-27 | Reporte de ausentismo (con contenido) y envío al SG-SST | HU-27 | CU-16 / DS-12 | DA-21 | T-03 | Media |
| T-28 | Reporte mensual de prolongadas por hito | HU-28 | CU-16 A1 / DS-12 | DA-19 | T-22 | Media |
| T-29 | Archivar pagada: verificar conciliado, eliminar epicrisis, correo sin adjuntos | HU-29 | CU-17 / DS-13 | DA-11, DA-12 | T-26 | Media |
| T-30 | Registrar el envío al archivo (fin del ciclo) | HU-30 | CU-17 / DS-13 | — | T-29 | Media |
| T-31 | Prueba integral: recorrido completo de una incapacidad con los usuarios de demostración; guía de la demo | Todas | AD-01 | DA-02 | T-30 | — |

Plan de días (referencia, del plan del equipo): día 1 = T-00; día 2 = T-01–02; día 3 = T-03–05; día 4 = T-06–08; día 5 = T-09–10; día 6 = T-11–12; día 7 = T-13–15; días 8–9 = T-16–20; día 10 = T-21; día 11 = T-22–24; día 12 = T-25–26; día 13 = T-27–28; día 14 = T-29–30; día 15 = T-31.

---

## 3. Estructura de carpetas

Es la de F1 §11.2, dentro de `codigo/`. Las adiciones van marcadas **[NUEVA]**.

```
codigo/
├── package.json
├── .env.example                  # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SMTP_*, DEMO_PASSWORD (sin valores)
├── vitest.config.js              # [NUEVA]
├── public/{css,js}/
├── supabase/                     # [NUEVA] proyecto local de Supabase CLI
│   ├── config.toml
│   ├── migrations/<fecha>_esquema_inicial.sql
│   └── seed.sql                  # entidades y plazos (DA-03)
├── scripts/
│   └── crear-usuarios-demo.js    # [NUEVA] 10 usuarios en Supabase Auth + tabla usuario (DA-02)
├── src/
│   ├── app.js
│   ├── config/{supabase.js, correo.js}
│   ├── config/festivos.js        # [NUEVA] festivos de Colombia, lista fija (DA-13)
│   ├── config/permisos.js        # [NUEVA] tabla operación → rol (DA-02)
│   ├── middleware/autenticacion.js   # sesión + rol + permisos + epicrisis (F1 §11.1)
│   ├── routes/      index.js + 14 <grupo>.routes.js
│   ├── views/       layout.ejs + iniciar-sesion.ejs [NUEVA] + 14 carpetas
│   ├── controllers/ 14 <grupo>.controller.js + control-incapacidades.js
│   ├── models/      13 <clase>.model.js + usuario.model.js [NUEVA]
│   ├── persistence/ 14 <grupo>.persistence.js + base-de-datos.js + almacen-documentos.js
│   └── servicios/correo.js
└── tests/                        # [NUEVA]
    ├── unit/<grupo>.test.js          # Control con persistencia y correo falsos
    ├── http/<grupo>.http.test.js     # rutas + middleware con Supertest
    ├── integracion/<grupo>.int.test.js  # contra Supabase local
    └── helpers/ (fábricas de datos, persistencia falsa, correo falso)
```

---

## 4. Modelo de datos (derivado de CL-01 + decisiones)

Convenciones **[NUEVA]**:
- Tablas y columnas en `snake_case`: Postgres pasa a minúsculas los identificadores sin comillas. Los modelos JS exponen los nombres del diseño en camelCase (`diasIncapacidad` ↔ `dias_incapacidad`). La persistencia hace la conversión.
- Claves primarias `bigint generated always as identity`.
- Fechas en `date` y momentos en `timestamptz`; dinero en `numeric(14,2)`.
- Cada clave foránea tiene su índice.
- Todas las tablas tienen `creado_por uuid` (FK a `usuario`) y `creado_en timestamptz default now()` (DA-23).
- **RLS activado en todas las tablas y sin políticas**: el navegador no puede leer nada. El servidor usa la clave *service role* (F1 §2.6).
- Los tipos de dato no están en el diseño (F1 §6.3); los de abajo son **[NUEVA]**.

| Tabla (clase) | Columnas | Restricciones / relación | Fuente |
| --- | --- | --- | --- |
| `usuario` **[NUEVA]** | id uuid (FK auth.users), correo text, rol text | rol ∈ {receptor, lider, auxiliar, contabilidad, cartera} | DA-02 |
| `colaborador` | id, nombre text, **correo** text | correo único | CL-01; DA-04 |
| `entidad` | id, nombre text, tipo text, plazo_transcripcion interval, permite_transcripcion_digital boolean | tipo ∈ {EPS, ARL, AFP} | CL-01; §5.2.1 |
| `incapacidad` | id (=idIncapacidad), colaborador_id, entidad_id, tipo, fecha_inicio date, dias_incapacidad int, fecha_recepcion date, estado text null, original_pendiente bool, documentacion_completa bool null, archivado_digital bool, faltantes text[], **fecha_aviso_faltantes** date, segundo_llamado bool, tiempo_pago text, causal_rechazo text, motivo_traslado text, decision text, concepto text, falta_concepto bool, pago_suspendido bool, ibc numeric, valor_empresa numeric, valor_eps numeric, **tramite_pension** bool, **fecha_nacimiento** date, enviada_a_gestion_documental bool | tipo ∈ 6 tipos; estado ∈ {null, transcrita, cobrada, rechazada, pagada}; decision ∈ {null, recuperar, dar_de_baja}; dias > 0 | CL-01; DA-10, DA-13 |
| `documento` | id, incapacidad_id, tipo text, archivo text (ruta en Storage) | tipo ∈ 7 tipos (DA-06); 1..* por incapacidad | CL-01; DA-06 |
| `reemplazo` | id, incapacidad_id **único**, reemplazo text | 0..1 | CL-01; DA-22 |
| `radicacion` | id, incapacidad_id, radicado text, evidencia text (ruta en Storage) | 0..* | CL-01 |
| `requerimiento` | id, incapacidad_id, fundamentos text | 0..* | CL-01 |
| `seguimiento` | id, incapacidad_id, evidencia text | 0..* | CL-01 |
| `acuerdo_pago` | id, incapacidad_id, fecha date, valor numeric | 0..* | CL-01 |
| `pago` | id, incapacidad_id, valor numeric, fecha_pago date, **conciliado** bool | 0..* | CL-01; DA-11, DA-16 |
| `pago_consignado` | id, entidad_id, colaborador text, dias_pagados int, valor numeric | Entidad 1 → 0..* | CL-01 (ver §8, P-B) |
| `conciliacion` | id, entidad_id, detalle jsonb, saldos_pendientes jsonb | Entidad 1 → 0..* | CL-01 |
| `reporte` | id, tipo text, periodo text (AAAA-MM), **contenido** jsonb | tipo ∈ {ausentismo, prolongadas} | CL-01; DA-21 |

Storage: bucket privado `documentos`, con rutas `incapacidades/{id}/{tipo}-{archivo}` (por colaborador y fecha de inicio: CAR-10).

---

## 5. Reglas de dominio que se programan (resumen con fuente)

| Regla | Dónde | Fuente |
| --- | --- | --- |
| Documentos obligatorios por tipo de caso (`compararConRequisitos`) | `verificacion.controller` | F1 §2.8; D-01, D-02, D-03 |
| Plazo de radicación y estado del plazo (`calcularPlazoRadicacion`) | `radicacion.controller` | §5.2.1; DA-13, DA-17 |
| 8 tipos de alerta (`calcularVencimientos`), días hábiles con festivos | `alertas.controller` | CU-09; DA-07, DA-13 |
| Transiciones de estado válidas (EST-01) | `cobro.controller` (`actualizarEstado`) + radicación | EST-01; DA-01, DA-05 |
| Evaluar demora (`evaluarDemora`) frente a tiempo_pago | `seguimiento.controller` | CU-11 |
| Tramos del IBC | `reconocimiento.controller` | CU-13; DA-09, DA-10 |
| Clasificar por hito 90/120/150/180 | `reportes.controller` | CU-16 |
| Comparar pagos (colaborador + valor) | `conciliacion.controller` | DA-11 |
| Archivo solo con pago conciliado; eliminar epicrisis | `archivo.controller` | CU-17; DA-11, DA-12 |
| Advertir y no bloquear | todos | D-10; DA-14 |

---

## 6. Estrategia de pruebas

**Niveles:**
- **U (unitario):** Control con persistencia y correo **falsos** inyectados. Rápido y sin red. Cubre las reglas de dominio y las notificaciones (se verifica destinatario y contenido).
- **H (HTTP):** rutas + middleware con Supertest, con la persistencia falsa. Cubre sesión, permisos por rol, códigos de respuesta y la confirmación en pantalla.
- **I (integración):** contra Supabase local (`supabase start`). Cubre la persistencia real, las restricciones de la base de datos, Storage privado y RLS.

**Convención:** cada test lleva en su nombre el ID del criterio: `HU-07.CA2 — al registrar los documentos faltantes vuelve a "Documentos registrados"`. Así la columna «Implementado / Test» de la matriz se llena buscando los tests por ID.

**Regla de cierre de una HU:** todos sus CA tienen al menos un test en verde, más los tests de las decisiones DA que la afectan. `npm test` corre U y H; `npm run test:int` corre I.

**Criterios de aceptación → tests (64 CA):**

| HU | CA | Test(s) | Nivel |
| --- | --- | --- | --- |
| HU-01 | CA1 sin sesión → pide login | GET a una página protegida redirige a `/iniciar-sesion` | H |
| | CA2 login con Supabase Auth → entra | login con usuario de demostración crea la sesión | I |
| | CA3 petición sin sesión válida → rechazada | POST sin cookie o con token inválido → 401 | H |
| HU-02 | CA1 otro usuario no ve historia clínica ni epicrisis | receptor, líder, contabilidad y cartera → 403 en ver documento de esos tipos | H |
| | CA2 el auxiliar sí las ve | auxiliar → 200 con el archivo | H, I |
| | CA3 bucket privado, sin acceso desde el navegador | URL pública del objeto → denegada; descarga anónima falla | I |
| | DA-02 permisos por actor | por cada operación, un rol no permitido → 403 (tabla de §4 de las decisiones) | H |
| HU-03 | CA1 receptor registra 6 datos → id + confirmación | U + H |
| | CA2 auxiliar por correo → igual | H |
| | CA3 tipo ∈ 6 valores | tipo inválido → error de validación; constraint en la base de datos | U, I |
| | CA4 estado inicial sin valor | estado es null tras registrar | U, I |
| HU-04 | CA1 guarda tipo + archivo, asocia, correo al auxiliar, confirma | U (correo notificarRecepcion), I (Storage) |
| | CA2 por correo → original pendiente, sin aviso | U |
| HU-05 | CA1 guarda y confirma | U, H |
| | CA2 máximo uno (DA-22: el segundo reemplaza) | U, I (índice único) |
| HU-06 | CA1 compara con obligatorios y muestra el resultado | U: un caso por cada uno de los 6 tipos + excepción «EPS ya transcribió» + EG ≤ 2 días |
| | CA2 completa → registra y archiva en digital | U |
| | CA3 faltan → no archiva | U |
| HU-07 | CA1 guarda faltantes, correo al colaborador con 3 días hábiles, confirma | U |
| | CA2 al registrar los documentos vuelve a estar lista para verificar | U |
| HU-08 | CA1 registra el segundo llamado y avisa a la Coordinación | U |
| HU-09 | CA1 muestra entidad, canal y plazo | U |
| | CA2 por vencer / vencido advierte sin bloquear | U (3 casos: al día, por vencer, vencido), H (vencido → 200) |
| HU-10 | CA1 guarda la radicación y estado → transcrita | U, I |
| | CA2 rechazada + nueva radicación → transcrita; varias radicaciones | U, I |
| HU-11 | CA1 lista filtrada con estado | U (cada filtro de DA-20), I |
| | CA2 no modifica datos | U (la persistencia falsa no recibe escrituras) |
| HU-12 | CA1 por vencer y vencidos de los 8 plazos | U: un test por cada plazo (envío 2 d, subsanación 3 d hábiles con festivo, transcripción por entidad, Salud Total tránsito, paternidad 30 d, hitos 90/120/150/180) |
| | CA2 no bloquea | H: con alertas vencidas, las operaciones responden 200 |
| HU-13 | CA1 transcrita → cobrada + tiempo de pago | U; transición inválida (desde null) → error |
| HU-14 | CA1 transcrita → rechazada + causal mostrada | U |
| | CA2 luego HU-10 → transcrita | U |
| HU-15 | CA1 valor + fecha → pagada | U |
| | CA2 la misma función desde seguimiento y cobro jurídico | H: las tres rutas llaman a `cobro.registrarPago` |
| | CA3 varios pagos | I |
| HU-16 | CA1 lista de cobradas pendientes (sin dadas de baja, DA-18) | U |
| | CA2 ya pagó → HU-15 | H |
| | CA3 seguimiento con evidencia + evalúa demora | U (con y sin demora) |
| HU-17 | CA1 demora → correo a la Coordinación | U |
| | CA2 acuerdo con fecha y valor | U, I |
| HU-18 | CA1 guarda fundamentos (solo cobrada, DA-05) | U (rechazada → error) |
| | CA2 mínimo dos | U: advierte con menos de 2 (DA-14) |
| HU-19 | CA1 traslado con motivo + correo a Cartera | U |
| | CA2 pago posterior con HU-15 | U |
| HU-20 | CA1 Cartera registra la decisión | U, H (solo el rol cartera) |
| | CA2 solo registra, sin cambiar estado | U |
| HU-21 | CA1 tramos 100/67/50 y pensión | U: casos de 2, 3, 90, 91, 180 y 181 días |
| | CA2 guarda ibc, valores y trámite de pensión | U, I |
| | CA3 el IBC se pide al calcular, no al registrar | H: el formulario de registro no tiene IBC |
| HU-22 | CA1 reporte de más de 90 días (en vivo) | U |
| | CA2 concepto + correo al colaborador | U |
| | CA3 sin envío a la AFP desde el sistema | U: ninguna notificación a la AFP |
| HU-23 | CA1 falta del concepto + correo | U |
| HU-24 | CA1 suspensión + correo (más de 180 días) | U |
| | CA2 reintegro fuera del sistema | U: no existe operación de reintegro (no-op documentado) |
| HU-25 | CA1 guarda la lista + correo al auxiliar + confirma | U, H (solo el rol contabilidad) |
| HU-26 | CA1 compara por entidad | U |
| | CA2 todo identificado → conciliación + correo + `pago.conciliado` | U, I |
| | CA3 saldos → guarda + correo | U |
| HU-27 | CA1 consolida, guarda con contenido, envía al SG-SST, muestra | U, I |
| HU-28 | CA1 clasifica por hito y guarda | U |
| HU-29 | CA1 lista de pagadas | U |
| | CA2 conciliado → elimina epicrisis, correo sin adjuntos, confirma | U, I (el objeto desaparece de Storage) |
| | CA3 no conciliado → advertencia, no envía | U |
| HU-30 | CA1 registra el envío → fin del ciclo | U |
| T-31 | Recorrido completo AD-01 | I |

---

## 7. Flujo de trabajo de la Fase 3

1. Una rama por módulo (`modulo-02-registro`), con commits por HU (`feat(HU-03): …`).
2. Antes de programar una HU: releer su CU, DS y DA.
3. Al cerrar cada HU: tests en verde, más la columna «Implementado / Test» de `docs/auditoria/01_matriz_trazabilidad.md`.
4. Si algo no está cubierto por la documentación ni por las DA: **me detengo y pregunto**.

---

## 8. Decisiones nuevas de este plan que necesitan tu aprobación

| ID | Decisión propuesta | Alternativa |
| --- | --- | --- |
| P-A | Herramientas: Vitest + Supertest + zod; Supabase local para las pruebas de integración | `node:test` sin dependencias extra |
| P-B | `pago_consignado.colaborador` se guarda como **texto** (como en CL-01) y se compara por nombre normalizado. | Cambiarlo a FK `colaborador_id` (más robusto, pero cambia el diagrama de clases) |
| P-C | Salud Total exige transcribir los accidentes de tránsito en 15 días (§5.2.1). Se agrega la columna `plazo_transcripcion_transito interval null` en `entidad`. | Ignorar la excepción (incumple el procedimiento) |
| P-D | La «evidencia» de radicación y de seguimiento es un **archivo** en Storage (por ejemplo, el pantallazo del portal). | Texto libre |
| P-E | Nombres en la base de datos en `snake_case`, mapeados al camelCase del diseño en la persistencia | Columnas en camelCase con comillas (no recomendado en Postgres) |
| P-F | Archivos nuevos: `config/festivos.js`, `config/permisos.js`, `iniciar-sesion.ejs`, `usuario.model.js`, `supabase/`, `scripts/`, `tests/` | — |
| P-G | `codigo/` es la raíz del proyecto y ocupa el lugar de `sigi/` del PDF (estructura del repositorio: `docs/` y `codigo/`) | Crear `codigo/sigi/` |
