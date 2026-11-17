# 01 · Matriz de trazabilidad HU ↔ documentación — SIGI

> Fase 1 de la auditoría. Fecha: 2026-11-16. Fuentes: ver `00_inventario.md`. Los hallazgos (H-xx) están en `02_hallazgos.md`; los pendientes (P-x) son los 8 «pendientes de definición» que ya registró el equipo.

**Estados:** ✅ Confirmado · ⚠️ Inferido / parcial · ❌ Contradicción o falta · ❓ No verificable

Criterio: una HU está ✅ solo si su rol es un actor del CU, cada criterio de aceptación tiene respaldo en un flujo del CU, hay DS/CO que lo muestra, las clases existen y no hay un pendiente o hallazgo que impida implementarla tal como está escrita.

## A. HU → documentación

| HU | Actor | CU | Secuencia / Comunicación | Clases | Criterios cubiertos | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| HU-01 | 8 roles internos; coinciden con Visión §5.3. ⚠️ Coordinación, SG-SST y Gestión Documental no tienen ninguna interacción con la Vista en los DS | — (ningún CU; sale de Visión §5.3 y F1 §2.6) | — (sin DS); componente Auth en CMP-01 | — (los roles no son clases con atributos) | 3/3 con respaldo en la arquitectura, ninguno en un CU | ⚠️ H-03, P-2 |
| HU-02 | Auxiliar ✅ | — (CAR-11; CU-04 y CU-17 tocan la epicrisis) | Ningún DS muestra cómo se abre o descarga un documento | Documento.tipo (no se define el valor «historia clínica») | 1 de 3 (crit. 3: bucket privado, F1 §2.6). Los crit. 1 y 2 no tienen flujo | ⚠️ H-04, P-2 |
| HU-03 | Receptor, Auxiliar ✅ | CU-01 (principal + A1) | DS-01 / CO-01 | Incapacidad, Colaborador, Entidad ✅ | 4/4 (estado inicial sin valor: EST-01) | ⚠️ P-3: no hay de dónde elegir colaborador ni entidad |
| HU-04 | Receptor, Auxiliar ✅ | CU-02 (principal + A1) | DS-01 / CO-01 (notificarRecepcion, marcarOriginalPendiente) | Documento (tipo, archivo), Incapacidad.originalPendiente ✅ | 2/2 | ✅ |
| HU-05 | Líder ✅ | CU-03 | DS-02 / CO-02 | Reemplazo 0..1 ✅ | 2/2 | ✅ (nota menor en H-22) |
| HU-06 | Auxiliar ✅ | CU-04 (principal + A1) | DS-03 / CO-03 | Incapacidad.documentacionCompleta, archivadoDigital ✅ | 3/3 | ✅ (ver H-09 sobre «para poder radicarla») |
| HU-07 | Auxiliar ✅ (Colaborador como receptor) | CU-05 principal | DS-03 / CO-03 | Incapacidad.faltantes ✅; Colaborador sin correo ❌ | Crit. 1 ✅. Crit. 2 («vuelve a quedar lista para verificarse») solo en EST-02, no en CU-05 | ⚠️ P-1 |
| HU-08 | Auxiliar ✅ (Coordinación como receptor) | CU-05 A1 | DS-03 / CO-03 (opt) | Incapacidad.segundoLlamado ✅ | 1/1 en el CU, pero EST-02 lo modela como transición automática | ❌ H-08, P-4 |
| HU-09 | Auxiliar ✅ | CU-06 pasos 1–2 | DS-04 / CO-04 | Entidad.plazoTranscripcion, permiteTranscripcionDigital ✅ | Crit. 1 parcial: el DS devuelve (entidad, plazo, vencido), no «por vencer» ni el canal. Crit. 2 ✅ | ⚠️ H-15, P-3, P-4 |
| HU-10 | Auxiliar ✅ | CU-06 pasos 5–6 | DS-04 / CO-04: **no hay mensaje que cambie el estado** | Radicacion 0..* ✅; Incapacidad.estado | Crit. 1: radicación ✅; «estado → transcrita» solo en EST-01. Crit. 2: EST-01 ✅, CU/DS ❌ | ❌ H-01 |
| HU-11 | Auxiliar ✅ | CU-08 | DS-05 / CO-05 | Incapacidad.estado ✅ | 2/2, pero «filtros» sin definir | ⚠️ P-6 |
| HU-12 | Auxiliar ✅ | CU-09 | DS-14 / CO-14 | No existe ninguna clase ni atributo «plazo»; faltan fechas (nacimiento, aviso de faltantes) | 2/2 en el texto, sin datos para calcularlos | ⚠️ P-4, P-3 |
| HU-13 | Auxiliar ✅ | CU-10 principal | DS-06 / CO-06 | Incapacidad.estado, tiempoPago ✅ | 1/1 | ✅ (depende de H-01 para llegar a «transcrita») |
| HU-14 | Auxiliar ✅ | CU-10 A2 | DS-06 / CO-06 | Incapacidad.causalRechazo ✅ | 2/2 | ✅ |
| HU-15 | Auxiliar ✅ | CU-10 A1, CU-11, CU-12 | DS-06/07/08 | Pago 0..* ✅ | Crit. 1: «valor y su fecha», pero registrarPago(id, valor) no lleva la fecha. Crit. 3: «varios pagos» frente al paso a pagada con el primero | ⚠️ H-11, H-12 |
| HU-16 | Auxiliar ✅ | CU-11 principal + A1 | DS-07 / CO-07 | Seguimiento 0..* ✅ | 3/3 | ✅ |
| HU-17 | Auxiliar ✅ (Coordinación como receptor) | CU-11 A2 | DS-07 / CO-07 | AcuerdoPago ✅ | 2/2 | ✅ |
| HU-18 | Auxiliar ✅ | CU-12 pasos 1–4 | DS-08 / CO-08 (loop) | Requerimiento 0..* ✅ | Crit. 1: «demora **o rechazo**» contradice EST-01 y AD-01. Crit. 2: no dice si el sistema hace cumplir el mínimo de dos | ❌ H-02, H-13 |
| HU-19 | Auxiliar ✅ (Cartera como receptor) | CU-12 pasos 5–6 | DS-08 / CO-08 (opt) | Incapacidad.motivoTraslado ✅ | 2/2. Falta definir desde cuándo cuentan los «180 días» | ⚠️ H-13 |
| HU-20 | Cartera y Jurídica ✅ | CU-12 A1.3 | DS-08 / CO-08 | Incapacidad.decision ✅ | 2/2 | ✅ (H-14 trata qué pasa después de «dar de baja») |
| HU-21 | Auxiliar ✅ | CU-13 | DS-09 / CO-09 | Incapacidad.ibc, valorEmpresa, valorEPS ✅; **ningún atributo guarda el trámite de pensión** ❌ | Tramos ✅; «marca trámite de pensión» sin dónde guardarse; fórmula sin definir | ❌ H-06, P-5 |
| HU-22 | Auxiliar ✅ | CU-14 pasos 1–8 | DS-10 / CO-10 | Incapacidad.concepto ✅ | 3/3; correo del colaborador sin definir | ⚠️ P-1, H-16 |
| HU-23 | Auxiliar ✅ | CU-14 A1 | DS-10 / CO-10 | Incapacidad.faltaConcepto ✅ | 1/1; registrarFaltaConcepto() no lleva el id | ⚠️ P-1, H-10 |
| HU-24 | Auxiliar ✅ | CU-14 A2 | DS-10 / CO-10 | Incapacidad.pagoSuspendido ✅ | 2/2 | ⚠️ P-1 |
| HU-25 | Contabilidad y Tesorería ✅ | CU-15 pasos 1–3 | DS-11 / CO-11 | PagoConsignado ✅ | 1/1 | ✅ |
| HU-26 | Auxiliar ✅ | CU-15 pasos 4–7 + A1 | DS-11 / CO-11 | Conciliacion ✅ | 3/3 en el texto; compararPagos() no tiene regla de comparación ni formato del detalle | ⚠️ H-23, P-8 |
| HU-27 | Auxiliar ✅ (SG-SST como receptor) | CU-16 principal | DS-12 / CO-12 | Reporte (tipo, periodo): no guarda contenido | 1/1, sin columnas definidas | ⚠️ P-7 |
| HU-28 | Auxiliar ✅ | CU-16 A1 | DS-12 / CO-12 | Reporte ✅ | 1/1 | ✅ |
| HU-29 | Auxiliar ✅ (Gestión Documental como receptor) | CU-17 pasos 1–5 + A1 + A2 | DS-13 / CO-13 | Incapacidad, Documento ✅ | 3/3 en el texto; «identificado y conciliado» sin regla; qué se hace con la historia clínica | ⚠️ P-8, H-17 |
| HU-30 | Auxiliar ✅ | CU-17 pasos 6–8 | DS-13 / CO-13 | Incapacidad.enviadaAGestionDocumental ✅ | 1/1 (estado final: EST-01) | ✅ |

**Resumen:** ✅ 11/30 (36,7 %) · ⚠️ 15/30 (50 %) · ❌ 4/30 (13,3 %) · ❓ 0.

## B. Documentación → HU

| Elemento | ¿Tiene HU? | Observación |
| --- | --- | --- |
| CU-01 a CU-06, CU-08 a CU-17 | Sí | Todos cubiertos. |
| CU-07 Transcribir incapacidad | No | Justificado en F2: el sistema no participa. ⚠️ H-20: está dentro de la frontera del sistema aunque no tiene ninguna respuesta del sistema. |
| CU-06 A1 (transcripción) | No | Igual que CU-07: ocurre fuera del sistema. |
| CU-12 A2 (tutela) | Indirecta (HU-20) | Se tramita fuera; solo se registra la decisión. ✅ |
| CU-12 A3 (no hay condición de traslado) | No | No requiere acción del sistema. ✅ |
| CU-14 pasos 7–8 (envío a la AFP) | Mencionado en HU-22 como externo | ✅ |
| CU-17 A1 «tiene historia clínica **o** epicrisis» | HU-29 solo habla de la epicrisis | ⚠️ H-17 |
| EST-02 transición *after(3 días hábiles)* | Ninguna HU pide un temporizador | ❌ H-08 |
| EST-01: sin salida tras «dar de baja» | Ninguna HU | ⚠️ H-14 |
| Las 13 notificaciones | Todas tienen HU | ✅ (notificarRecepcion→HU-04 … enviarParaArchivo→HU-29) |
| Mensajes y participantes de los DS | — | Todos los participantes son actores del CU o las 3 clases de capa. No hay mensajes sin CU. ✅ |
| Coordinación, SG-SST y Gestión Documental como usuarios con sesión | HU-01 | No tienen pantallas ni operaciones en ningún DS. ⚠️ H-03 |

## C. Coherencia entre diagramas (resumen; detalle en los hallazgos)

| Comprobación | Resultado |
| --- | --- |
| Mismo actor y nombre de CU en el diagrama de CU, los CU documentados y los DS | ✅ (en los DS se usan abreviaturas como «Auxiliar de Admón.»). Hay dos versiones del diagrama de CU: H-19. |
| Participantes de DS/CO existen como clases o actores | ✅ (Vista, Control y BD = 3 clases; actores en CL-01) |
| Mensajes de DS = operaciones de CL-01 | ✅ 31/42/38 operaciones coinciden con las tablas F1 §6.4 |
| DS ↔ CO del mismo CU | ✅ Los 14 pares tienen los mismos mensajes |
| DS ↔ EST | ❌ H-01 (transcrita), ❌ H-08 (segundo llamado), ❌ H-02 (rechazo → cobro persuasivo) |
| DS ↔ AD | ⚠️ H-09 (AD-01 exige verificar antes de radicar) y ❌ H-02 |
| DS ↔ Modelo | ❌ H-06 (trámite de pensión); ⚠️ H-10 (falta el id en varios mensajes); ⚠️ H-11 (fechaPago) |
| «extend» coherentes con los flujos | ✅ CU-05→CU-04 y CU-07→CU-06. ⚠️ CU-12→CU-11 se dispara también por «rechazo», que viene de CU-10, no de CU-11 (H-02) |

## Implementado / Test

Se llena al cerrar cada historia (plan de desarrollo §7). Los tests llevan el ID del criterio en el nombre.

| HU | Estado | Código | Tests |
| --- | --- | --- | --- |
| Base (T-00) | Hecha (2026-11-16) | `supabase/migrations/`, `supabase/seed.sql`, `scripts/crear-usuarios-demo.js`, `src/servicios/correo.js` | `tests/unit/correo.test.js`, `tests/unit/conversion.test.js`, `tests/http/base.http.test.js`, `tests/integracion/base.int.test.js` |
| HU-01 | Hecha (2026-11-16) | `src/middleware/autenticacion.js`, `src/servicios/sesion.js`, `src/routes/sesion.routes.js`, `src/views/iniciar-sesion.ejs` | CA1, CA2, CA3: `tests/http/sesion.http.test.js`; CA2, CA3: `tests/integracion/sesion.int.test.js` |
| HU-02 | Parcial (2026-11-16): permisos y restricción listos; la operación «ver documento» llega con HU-06 (T-06) | `src/config/permisos.js`, `permitir` y `restringirDocumento` en `src/middleware/autenticacion.js` | CA1, CA2 y DA-02: `tests/unit/permisos.test.js`, `tests/http/permisos.http.test.js` (rutas de ensayo); CA3: `tests/integracion/base.int.test.js` |
| HU-03 | Hecha (2026-11-16) | `src/routes/registro.routes.js`, `src/controllers/registro.controller.js`, `src/controllers/control-incapacidades.js`, `src/persistence/registro.persistence.js`, `src/persistence/base-de-datos.js`, `src/views/registro/registrar-incapacidad.ejs` | CA1: `tests/unit/registro.test.js`, `tests/http/registro.http.test.js`, `tests/integracion/registro.int.test.js`; CA2: `tests/http/registro.http.test.js`; CA3 y CA4: `tests/unit/registro.test.js`, `tests/integracion/registro.int.test.js`; DA-02, DA-03, DA-23 y HU-21.CA3 en los mismos archivos |
| HU-04 | Hecha (2026-11-16) | `src/routes/registro.routes.js`, `src/controllers/registro.controller.js`, `src/persistence/registro.persistence.js`, `src/persistence/almacen-documentos.js`, `src/views/registro/registrar-documentos.ejs`, `public/js/sigi.js` | CA1: `tests/unit/documentos.test.js`, `tests/http/documentos.http.test.js`, `tests/integracion/documentos.int.test.js` (Storage); CA2: los mismos tres archivos; DA-02, DA-06, DA-23 y HU-02.CA3 en los mismos archivos |
