# CONTEXTO DEL PROYECTO — SIGI

> Contexto permanente para el desarrollo. Antes de crear o modificar código, lee la sección 18.
> Fuente: Primera Entrega (Visión y Alcance, Acta de Constitución, casos de uso) y Segunda Entrega (análisis y diseño).

---

## 1. Información general

| Campo | Valor |
| --- | --- |
| Nombre | SIGI – Sistema Integral de Gestión de Incapacidades |
| Asignatura | Ingeniería de Software I — Universidad Tecnológica de Pereira |
| Profesor | Guillermo Roberto Solarte Martínez |
| Equipo (Segunda Entrega) | Juan Jose Rivera, Samuel Zuleta |
| Fuente del cliente | Procedimiento de Incapacidades, área de Gestión Humana, versión 001 |
| Tipo | Aplicación web interna, usada desde el navegador en varias sedes |

## 2. Objetivo del sistema

Apoyar al área de Administración de Personal en el trámite de las incapacidades médicas (origen común y laboral) y de las licencias de maternidad y paternidad. La empresa paga primero al colaborador y luego debe recuperar ese dinero de la EPS o la ARL. SIGI centraliza el registro, verifica la documentación, alerta los plazos y controla el estado del cobro y de la conciliación, desde la recepción hasta el pago y el archivo.

Problema que resuelve: hoy el trámite es manual y disperso; cada entidad tiene plazos y portales distintos y, si un plazo se vence, se pierde el derecho a cobrar.

## 3. Alcance

**Dentro del alcance**
- Registro de incapacidades y licencias, de su documentación y del reemplazo del colaborador.
- Verificación de la documentación, aviso de documentos faltantes y alertas de plazos.
- Registro de la radicación ante las EPS y la ARL y control del estado de cada incapacidad.
- Seguimiento del cobro, incluido el cobro persuasivo y el traslado a Cartera y Jurídica.
- Cálculo del valor a cargo de la empresa y de la EPS, y monitoreo de incapacidades prolongadas.
- Consolidación de pagos para la conciliación con Contabilidad y Tesorería.
- Reportes de ausentismo e incapacidades prolongadas, y archivo de las incapacidades pagadas.

**Fuera del alcance**
- No reemplaza los sistemas de nómina ni de contabilidad; las novedades de nómina quedan fuera.
- El colaborador NO usa el sistema: entrega documentos y recibe correos.
- NO hay integración automática con los portales de las EPS y la ARL: el personal radica, transcribe y cobra en los canales de cada entidad y SIGI solo registra el resultado.
- El sistema no toma decisiones jurídicas ni da de baja cuentas por cobrar (lo decide Cartera y Jurídica).
- El análisis con inteligencia artificial que menciona el procedimiento queda para una versión posterior.
- El reintegro de pagos de más de 180 días se gestiona fuera; el sistema solo registra la suspensión del pago.
- El sistema no impide radicar con el plazo vencido: solo advierte.

## 4. Actores

| Actor | ¿Usa el sistema? | Qué hace |
| --- | --- | --- |
| Colaborador | No | Entrega la incapacidad y los documentos; recibe correos (faltantes, concepto de rehabilitación, falta del concepto, suspensión del pago). |
| Personal receptor | Sí | Recepcionista, auxiliares administrativas de oficinas principales y líderes comerciales. Registra la incapacidad y los documentos. |
| Líder / Jefe inmediato | Sí | Registra el reemplazo del colaborador. |
| Auxiliar de Administración de Personal | Sí (usuario principal) | Registra lo que llega por correo, verifica, radica, cobra, hace seguimiento, calcula, monitorea, concilia, genera reportes y archiva. Único que ve la historia clínica y la epicrisis. |
| Coordinación de Administración de Personal | Sí | Recibe avisos de citación y de retraso; negocia pagos demorados. |
| Contabilidad y Tesorería | Sí | Registra los pagos consignados; recibe el detalle conciliado y los saldos pendientes. |
| Cartera y Jurídica | Sí | Recibe los traslados; registra la decisión de recuperar o dar de baja. |
| SG-SST | Sí | Recibe el reporte de ausentismo. |
| Gestión Documental | Sí | Recibe las incapacidades pagadas para archivo. |
| EPS / ARL / AFP | No | Entidades externas; se comunican con las personas, no con el sistema. |

## 5. Módulos

| # | Módulo | Grupo de código | Casos de uso |
| --- | --- | --- | --- |
| 1 | Acceso y seguridad | `middleware/autenticacion.js` | Visión §5.3 |
| 2 | Registro y recepción | `registro`, `reemplazo` | CU-01, CU-02, CU-03 |
| 3 | Verificación documental | `verificacion` | CU-04, CU-05 |
| 4 | Radicación | `radicacion` | CU-06 (CU-07 ocurre fuera del sistema) |
| 5 | Estados y alertas | `estados`, `alertas` | CU-08, CU-09 |
| 6 | Cobro | `cobro` | CU-10 |
| 7 | Seguimiento y escalamiento | `seguimiento`, `cobro-juridico` | CU-11, CU-12 |
| 8 | Reconocimiento económico | `reconocimiento` | CU-13 |
| 9 | Incapacidades prolongadas | `monitoreo` | CU-14 |
| 10 | Conciliación contable | `conciliacion` | CU-15 |
| 11 | Reportes | `reportes` | CU-16 |
| 12 | Archivo | `archivo` | CU-17 |

## 6. Funcionalidades principales (características de la Visión)

- **CAR-01 Registro y recepción:** incapacidad, documentos y reemplazo, por cualquier canal.
- **CAR-02 Verificación documental:** según el tipo de caso; aviso de faltantes con 3 días hábiles; segundo llamado y aviso a la Coordinación.
- **CAR-03 Alertas de plazos:** por vencer y vencidos; informan, no bloquean.
- **CAR-04 Seguimiento de estados:** transcrita, cobrada, rechazada, pagada; causal de rechazo y nueva transcripción.
- **CAR-05 Cobro y escalamiento:** seguimiento semanal, requerimientos, traslado a Cartera y Jurídica.
- **CAR-06 Reconocimiento económico:** valor de la empresa y de la EPS según días y porcentajes del IBC.
- **CAR-07 Incapacidades prolongadas:** hitos 90/120/150/180, concepto de rehabilitación, suspensión del pago.
- **CAR-08 Conciliación contable:** detalle de pagos por entidad, colaborador, días pagados y valor.
- **CAR-09 Reportes:** ausentismo (SG-SST) y prolongadas.
- **CAR-10 Archivo digital:** documentos escaneados por colaborador y fecha de inicio; envío a Gestión Documental.
- **CAR-11 Información reservada:** historia clínica y epicrisis restringidas; la epicrisis se elimina al identificar el pago.

## 7. Reglas de negocio

**Registro**
- Contenido mínimo: colaborador, tipo, entidad (EPS o ARL), fecha de inicio, días de incapacidad y fecha de recepción.
- Tipos: enfermedad general, accidente laboral, enfermedad laboral, accidente de tránsito, licencia de maternidad, licencia de paternidad.
- Si llega por recepción, oficinas o líderes, registra el personal receptor; si llega por correo, registra el auxiliar.
- Si los documentos llegan por correo, el original en físico queda marcado como pendiente (el original es obligatorio).
- El registro del sistema reemplaza al Formato de Seguimiento del procedimiento.

**Documentos obligatorios por tipo de caso**

| Tipo | Documentos |
| --- | --- |
| Todos | Soporte (certificado) de la incapacidad en original, con diagnóstico, días e identificación. |
| Enfermedad general | + Epicrisis o documento soporte si supera 2 días (no se exige si la EPS ya transcribió). |
| Accidente laboral / Enfermedad laboral | + Epicrisis o documento soporte (no se exige si la EPS ya transcribió). |
| Accidente de tránsito | + Epicrisis o documento soporte + FURIPS. |
| Licencia de maternidad | Certificado, epicrisis o documento con semanas de gestación, certificado de nacido vivo, registro civil, fotocopia del documento de identidad. |
| Licencia de paternidad | Epicrisis o documento con semanas de gestación, certificado de nacido vivo, registro civil, fotocopia del documento de identidad de la madre. |

**Plazos (alertas)**
- Envío de la incapacidad: 2 días.
- Subsanación de documentos: 3 días hábiles; si no entrega, segundo llamado y aviso a la Coordinación.
- Transcripción: plazo propio de cada entidad. Procedimiento §5.2.1: Salud Total 12 meses (accidentes de tránsito 15 días), Nueva EPS 12 meses, SOS 12 meses, Sanitas 3 años, SURA EPS 150 días calendario, Asmet Salud 12 meses, ARL SURA 12 meses.
- Licencia de paternidad: transcribir en 30 días calendario desde el nacimiento (todas las EPS).
- Hitos de incapacidades prolongadas: 90, 120, 150 y 180 días.
- Las alertas informan y no bloquean ninguna operación.

**Entidades con trámite por correo:** SOS, Sanitas y Famisanar exigen la transcripción por correo y con personal de la entidad.

**Cobro**
- Ciclo de estados: ver sección 8.
- Seguimiento semanal de las incapacidades cobradas pendientes de pago.
- Si el pago supera el tiempo prometido por la entidad: aviso de retraso a la Coordinación y registro del acuerdo (fecha y valor).
- Cobro persuasivo: mínimo dos requerimientos.
- Traslado a Cartera y Jurídica: a los 180 días sin pago o por deterioro crediticio de la entidad.
- Cobro jurídico: primero el derecho de petición; la tutela solo si la entidad no responde. Se tramitan fuera del sistema; SIGI registra la decisión (recuperar o dar de baja).

**Reconocimiento económico (IBC)**
- Días 1 y 2: 100 % del IBC, a cargo de la empresa.
- Días 3 a 90: 67 % del IBC, a cargo de la EPS.
- Días 91 a 180: 50 % del IBC, a cargo de la EPS.
- Desde el día 181: se marca el trámite de pensión (el colaborador tramita ante el fondo de pensión o la EPS).
- El IBC lo ingresa el auxiliar al momento del cálculo, no en el registro.

**Prolongadas:** en el día 120 se solicita el concepto de rehabilitación; se envía a la AFP (fuera del sistema) y se comunica al colaborador; si no existe, se registra la falta y se avisa al colaborador; a los 180 días se registra la suspensión del pago y se notifica.

**Reportes:** ausentismo al SG-SST en los primeros 3 días de cada mes; reporte mensual de prolongadas clasificado por hito.

**Archivo:** solo se archiva si el pago está identificado y conciliado; antes de enviar se elimina la epicrisis; si el pago no está identificado, se advierte y no se envía.

## 8. Entidades y conceptos (Modelo: 13 clases, sin métodos)

| Clase | Atributos | Relación |
| --- | --- | --- |
| Colaborador | nombre | 1 Colaborador → 0..* Incapacidad |
| Entidad | nombre; tipo (EPS, ARL o AFP); plazoTranscripcion; permiteTranscripcionDigital | 0..* Incapacidad → 1 Entidad |
| Incapacidad | idIncapacidad; tipo; fechaInicio; diasIncapacidad; fechaRecepcion; estado; originalPendiente; documentacionCompleta; archivadoDigital; faltantes [0..*]; segundoLlamado; tiempoPago; causalRechazo; motivoTraslado; decision; concepto; faltaConcepto; pagoSuspendido; ibc; valorEmpresa; valorEPS; enviadaAGestionDocumental | Clase central |
| Documento | tipo; archivo | Incapacidad 1 ◆ 1..* (composición) |
| Reemplazo | reemplazo | Incapacidad 1 ◆ 0..1 |
| Radicacion | radicado; evidencia | Incapacidad 1 ◆ 0..* |
| Requerimiento | fundamentos | Incapacidad 1 ◆ 0..* |
| Seguimiento | evidencia | Incapacidad 1 ◆ 0..* |
| AcuerdoPago | fecha; valor | Incapacidad 1 ◆ 0..* |
| Pago | valor; fechaPago | Incapacidad 1 ◆ 0..* |
| PagoConsignado | entidad; colaborador; diasPagados; valor | 1 Entidad → 0..* |
| Conciliacion | detalle; saldosPendientes | 1 Entidad → 0..* |
| Reporte | tipo (ausentismo o prolongadas); periodo | — |

Los tipos de dato no están definidos en el diseño.

**Estados de la Incapacidad**
- Ciclo de cobro: registrada (estado sin valor) → `transcrita` (al registrar la radicación) → `cobrada` o `rechazada` → `pagada` → enviada a Gestión Documental (fin). Desde `rechazada`, una nueva radicación la devuelve a `transcrita`.
- Documentación: registrada sin documentos → documentos registrados → en verificación → verificada y archivada en digital. Si faltan: documentación incompleta (con faltantes → con segundo llamado tras 3 días hábiles); al llegar los documentos vuelve a «documentos registrados».

**Notificaciones (13, por correo institucional SMTP)**

| Mensaje | Destinatario |
| --- | --- |
| notificarRecepcion | Auxiliar |
| notificarFaltantes (plazo 3 días hábiles) | Colaborador |
| notificarCitacion | Coordinación |
| notificarRetraso | Coordinación |
| notificarTraslado | Cartera y Jurídica |
| comunicarConcepto | Colaborador |
| avisarFaltaConcepto | Colaborador |
| notificarSuspensionPago | Colaborador |
| notificarPagosPorIdentificar | Auxiliar |
| enviarDetalleConciliado | Contabilidad y Tesorería |
| notificarSaldosPendientes | Contabilidad y Tesorería |
| enviarReporteAusentismo | SG-SST |
| enviarParaArchivo | Gestión Documental |

## 9. Historias de usuario

El detalle completo (criterios Dado/Cuando/Entonces) está en el documento «Historias de Usuario – SIGI». Resumen:

| HU | Historia | Actor | Prioridad | Regla clave |
| --- | --- | --- | --- | --- |
| HU-01 | Iniciar sesión con el correo institucional | Usuarios internos | Alta | Sin sesión válida, el middleware rechaza la petición. |
| HU-02 | Restringir la historia clínica y la epicrisis | Auxiliar | Alta | Solo el auxiliar las ve; bucket privado, el navegador nunca accede directo. |
| HU-03 | Registrar incapacidad o licencia | Personal receptor / Auxiliar | Alta | Seis datos mínimos; queda en estado inicial sin valor. |
| HU-04 | Registrar la documentación recibida | Personal receptor / Auxiliar | Alta | Avisa al auxiliar; por correo marca el original pendiente. |
| HU-05 | Registrar el reemplazo | Líder | Baja | Máximo un reemplazo por incapacidad. |
| HU-06 | Verificar la documentación | Auxiliar | Alta | Compara con los obligatorios del tipo; si está completa, archiva en digital. |
| HU-07 | Notificar documentos faltantes | Auxiliar | Alta | Correo al colaborador con plazo de 3 días hábiles. |
| HU-08 | Registrar el segundo llamado | Auxiliar | Media | Avisa a la Coordinación la citación. |
| HU-09 | Preparar la radicación con su plazo | Auxiliar | Alta | Advierte plazo por vencer o vencido, sin bloquear. |
| HU-10 | Registrar la radicación | Auxiliar | Alta | Guarda radicado y evidencia; estado → transcrita. |
| HU-11 | Consultar el estado | Auxiliar | Alta | Solo lectura. |
| HU-12 | Ver las alertas de plazos | Auxiliar | Alta | Por vencer y vencidos; no bloquean. |
| HU-13 | Registrar cobrada | Auxiliar | Alta | Estado → cobrada; guarda tiempo de pago. |
| HU-14 | Registrar el rechazo | Auxiliar | Alta | Estado → rechazada; guarda causal. |
| HU-15 | Registrar el pago | Auxiliar | Alta | Estado → pagada; se programa una vez en `cobro` y se reutiliza. |
| HU-16 | Seguimiento semanal del cobro | Auxiliar | Media | Lista de cobradas pendientes; guarda seguimiento y evalúa demora. |
| HU-17 | Avisar retraso y registrar acuerdo | Auxiliar | Media | Retraso → correo a Coordinación; acuerdo con fecha y valor. |
| HU-18 | Registrar requerimientos | Auxiliar | Media | Con fundamentos; mínimo dos antes del traslado. |
| HU-19 | Trasladar a Cartera y Jurídica | Auxiliar | Media | Con motivo; correo a Cartera y Jurídica. |
| HU-20 | Registrar la decisión de Cartera y Jurídica | Cartera y Jurídica | Baja | Recuperar o dar de baja; el sistema solo registra. |
| HU-21 | Calcular el reconocimiento económico | Auxiliar | Media | Tramos 100 % / 67 % / 50 % / trámite de pensión. |
| HU-22 | Consultar prolongadas y registrar el concepto | Auxiliar | Media | Correo al colaborador con el concepto. |
| HU-23 | Registrar la falta del concepto | Auxiliar | Media | Correo al colaborador. |
| HU-24 | Registrar la suspensión del pago | Auxiliar | Media | Más de 180 días; correo al colaborador. |
| HU-25 | Registrar los pagos consignados | Contabilidad y Tesorería | Media | Avisa al auxiliar que hay pagos por identificar. |
| HU-26 | Identificar los pagos y conciliar | Auxiliar | Media | Identificados → detalle a Contabilidad; si no, saldos pendientes. |
| HU-27 | Reporte de ausentismo | Auxiliar | Media | Se envía al SG-SST. |
| HU-28 | Reporte mensual de prolongadas | Auxiliar | Media | Clasificado por hito. |
| HU-29 | Archivar una incapacidad pagada | Auxiliar | Media | Solo con pago identificado y conciliado; elimina la epicrisis. |
| HU-30 | Registrar el envío al archivo | Auxiliar | Media | Cierra el ciclo de la incapacidad. |

## 10. Arquitectura

- Patrón **MVC** con una capa de **Persistencia** separada: Vista → Controlador → Persistencia → Supabase. El Modelo son las 13 clases de datos.
- **Una sola clase por capa** (como en el diagrama de clases): Interfaz de incapacidades (Vista, 31 operaciones), Control de incapacidades (Controlador, 42), Base de datos (Persistencia, 38).
- Las operaciones se reparten en **14 grupos**, uno por diagrama de secuencia; los mismos grupos existen en `routes/`, `views/`, `controllers/` y `persistence/`.
- Un archivo índice compone los 14 archivos de cada capa: `control-incapacidades.js` y `base-de-datos.js`.
- Componentes externos: Supabase (Auth, PostgreSQL con 13 tablas, Storage con bucket privado) y servidor de correo institucional (SMTP).
- Despliegue: equipo del usuario (navegador) → servidor de aplicación (Node.js + Express) por HTTPS → Supabase (HTTPS) y correo (SMTP). El servidor de aplicación es genérico: ubicación y proveedor sin definir.

**Operaciones por grupo**

| Grupo | Vista (plantillas) | Control | Persistencia |
| --- | --- | --- | --- |
| registro | registrarIncapacidad, registrarDocumentos | registrarIncapacidad, registrarDocumentos | guardarIncapacidad, guardarDocumentos, marcarOriginalPendiente |
| reemplazo | registrarReemplazo | registrarReemplazo | guardarReemplazo |
| verificacion | verificarDocumentacion, confirmarVerificacion, notificarFaltantes, registrarSegundoLlamado | verificarDocumentacion, compararConRequisitos, registrarVerificacion, registrarFaltantes, registrarSegundoLlamado | obtenerExpediente, archivarDigital, guardarFaltantes, guardarSegundoLlamado |
| radicacion | prepararRadicacion, registrarRadicacion | prepararRadicacion, calcularPlazoRadicacion, registrarRadicacion | obtenerDatosRadicacion, guardarRadicacion |
| estados | consultarEstados | obtenerEstados | consultarIncapacidades |
| cobro | registrarCobrada, registrarRechazo, registrarPago | actualizarEstado(cobrada / rechazada / pagada) | guardarEstado, guardarRechazo, guardarPago |
| seguimiento | consultarPendientesDePago, registrarSeguimiento, registrarAcuerdo | obtenerPendientes, registrarSeguimiento, evaluarDemora, registrarAcuerdo | consultarCobradas, guardarSeguimiento, guardarAcuerdo |
| cobro-juridico | registrarRequerimiento, trasladarACartera, registrarDecision | registrarRequerimiento, trasladarACartera, registrarDecision | guardarRequerimiento, guardarTraslado, guardarDecision |
| reconocimiento | calcularReconocimiento | calcularReconocimiento, calcularValorEmpresa, calcularValorEPS(67 %), calcularValorEPS(50 %), marcarTramitePension | obtenerDatosCalculo, guardarCalculo |
| monitoreo | consultarReporteProlongadas, registrarConcepto, registrarFaltaConcepto, registrarSuspensionPago | obtenerReporteProlongadas, registrarConcepto, registrarFaltaConcepto, registrarSuspensionPago | consultarReporte, guardarConcepto, guardarFaltaConcepto, guardarSuspension |
| conciliacion | registrarPagosConsignados, identificarPagos | registrarPagosConsignados, identificarPagos, compararPagos | guardarPagosConsignados, obtenerPagosConsignados, guardarConciliacion, guardarSaldosPendientes |
| reportes | generarReporte | generarReporte, consolidarDatos, clasificarPorHito | consultarDatosReporte, guardarReporte |
| archivo | consultarPagadas, archivarIncapacidad, registrarEnvioArchivo | obtenerPagadas, archivarIncapacidad, registrarEnvioArchivo | consultarPagadas, obtenerEstadoPago, eliminarEpicrisis, guardarEnvio |
| alertas | consultarAlertas | obtenerAlertas, calcularVencimientos | consultarPlazos |

## 11. Tecnologías

- **Backend:** Node.js con Express.
- **Vistas:** generadas en el servidor con plantillas `.ejs` (el motor es un detalle de implementación).
- **Base de datos y documentos:** Supabase — PostgreSQL y Storage (bucket privado).
- **Autenticación:** Supabase Auth con el correo institucional.
- **Correo:** correo institucional por SMTP.

## 12. Estructura del proyecto

```
sigi/
├── package.json
├── .env.example            # URL y clave de Supabase, datos del servidor de correo
├── public/
│   ├── css/
│   └── js/
└── src/
    ├── app.js              # arranque de Express
    ├── config/
    │   ├── supabase.js
    │   └── correo.js
    ├── middleware/
    │   └── autenticacion.js  # sesión + restricción de historia clínica y epicrisis
    ├── routes/             # index.js + 14 archivos <grupo>.routes.js
    ├── views/              # layout.ejs + una carpeta por grupo, una plantilla por operación de la Vista
    ├── controllers/        # 14 archivos <grupo>.controller.js + control-incapacidades.js (índice)
    ├── models/             # 13 archivos <clase>.model.js, sin métodos
    ├── persistence/        # 14 archivos <grupo>.persistence.js + base-de-datos.js (índice) + almacen-documentos.js (Storage)
    └── servicios/
        └── correo.js       # envío de las 13 notificaciones
```

Grupos: `registro`, `reemplazo`, `verificacion`, `radicacion`, `estados`, `cobro`, `seguimiento`, `cobro-juridico`, `reconocimiento`, `monitoreo`, `conciliacion`, `reportes`, `archivo`, `alertas`.

Modelos: `colaborador`, `incapacidad`, `entidad`, `documento`, `reemplazo`, `radicacion`, `requerimiento`, `seguimiento`, `acuerdo-pago`, `pago`, `pago-consignado`, `conciliacion`, `reporte`.

## 13. Convenciones y decisiones técnicas tomadas

- Carpetas y archivos en minúsculas con guiones; plantillas con el nombre de la operación de la Vista.
- Cada archivo de grupo indica en su encabezado su diagrama de secuencia (DS-01 a DS-14) y las operaciones que contiene.
- Operaciones compartidas (`registrarPago`, `actualizarEstado(pagada)`, `guardarPago`) se programan una sola vez en el grupo `cobro` y se reutilizan desde `seguimiento` y `cobro-juridico`.
- Los nombres de operaciones, clases y atributos son los del diseño; no se renombran.
- Los documentos escaneados se guardan en Storage y la tabla Documento guarda la referencia al archivo.
- Las 13 clases del Modelo se representan como 13 tablas.

## 14. Restricciones

- El colaborador y las entidades no tienen acceso al sistema.
- Sin integración con portales de EPS/ARL; la radicación y la transcripción se hacen fuera y solo se registran.
- Las alertas nunca bloquean operaciones.
- La historia clínica y la epicrisis solo las ve el auxiliar; el navegador nunca accede directamente al bucket.
- ~~No se definen permisos por rol más allá de la restricción anterior.~~ **Cambiado por DA-02 (auditoría, 2026-11-16):** cada operación solo la ejecuta el actor que la envía en su diagrama de secuencia; 10 usuarios de demostración `@sigi.test` (2 por rol); Coordinación, SG-SST y Gestión Documental sin cuenta. Ver `docs/auditoria/03_decisiones.md`.
- Sin inteligencia artificial en esta versión.

## 15. Dependencias entre módulos

```
1 Acceso y seguridad
 └─ 2 Registro y recepción
     ├─ 3 Verificación documental
     ├─ 4 Radicación ─ 6 Cobro ─ 7 Seguimiento y escalamiento
     │                    └─ 10 Conciliación ─ 12 Archivo
     ├─ 5 Estados y alertas
     ├─ 8 Reconocimiento económico
     ├─ 9 Incapacidades prolongadas
     └─ 11 Reportes
```

## 16. Orden de implementación (15 días)

Se trabaja **módulo por módulo, del 1 al 12**. Cada módulo se programa, se prueba con los criterios de aceptación de sus historias y se deja terminado antes de empezar el siguiente. No se empieza un módulo con el anterior sin probar.

| Día | Módulo | Historias | Pendientes (sección 17) a resolver antes |
| --- | --- | --- | --- |
| 1 | Base: Express + EJS, estructura, Supabase, 13 tablas, layout, SMTP | — | — |
| 2 | M1 Acceso y seguridad | HU-01, HU-02 | 2 |
| 3 | M2 Registro y recepción | HU-03, HU-04, HU-05 | 3 |
| 4 | M3 Verificación documental | HU-06, HU-07, HU-08 | 1, 4 |
| 5 | M4 Radicación | HU-09, HU-10 | — |
| 6 | M5 Estados y alertas | HU-11, HU-12 | 4, 6 |
| 7 | M6 Cobro | HU-13, HU-14, HU-15 | — |
| 8 y 9 | M7 Seguimiento y escalamiento | HU-16 a HU-20 | — |
| 10 | M8 Reconocimiento económico | HU-21 | 5 |
| 11 | M9 Incapacidades prolongadas | HU-22, HU-23, HU-24 | — |
| 12 | M10 Conciliación contable | HU-25, HU-26 | — |
| 13 | M11 Reportes | HU-27, HU-28 | 7 |
| 14 | M12 Archivo | HU-29, HU-30 | 8 |
| 15 | Prueba integral del recorrido completo, pruebas de aceptación y correcciones | Todas | — |

## 17. Estado actual del proyecto

- Primera Entrega (Visión y Alcance, Acta, diagrama de casos de uso) y Segunda Entrega (casos de uso documentados, 14 diagramas de secuencia y 14 de comunicación, diagrama de clases, 7 de actividades, 2 de estados, componentes, despliegue y estructura de carpetas) **terminadas**.
- **Auditoría de trazabilidad: aprobada (2026-11-16).** Hallazgos y decisiones en `docs/auditoria/` (DA-01 a DA-25). Las decisiones prevalecen sobre este archivo donde lo contradigan.
- **Código (2026-11-16):** base del proyecto (T-00a a T-00d) en la rama `modulo-00-base`; módulo 1, Acceso y seguridad (T-01 y T-02: HU-01 y permisos de HU-02) en la rama `modulo-01-acceso`. Estilo visual elegido: «Operativa» (barra lateral, azul, fuente Inter alojada en el proyecto). De HU-02 falta la operación «ver documento», que llega con HU-06. Módulo 2, Registro y recepción, en la rama `modulo-02-registro`: T-03 (HU-03, registrar incapacidad) hecha; el colaborador se identifica por su correo y se crea al registrar si no existe (DA-03, DA-04). T-04 (HU-04, registrar documentos) hecha: lista con una fila por tipo de documento (se elige el archivo o se arrastra a la fila), archivos en el bucket privado con ruta `incapacidades/{id}/{tipo}-{uuid}.{ext}`; el canal sale del rol (receptor: aviso al auxiliar; auxiliar: original pendiente, sin aviso). T-05 (HU-05, registrar reemplazo) hecha: el líder busca la incapacidad por su número y escribe el nombre de quien reemplaza; si ya había un reemplazo, el campo llega con ese nombre y guardar otro lo sustituye (DA-22). El líder solo ve colaborador, fecha de inicio y días, sin tipo ni entidad. Con esto queda completo el módulo 2. Próximo paso: T-06 (HU-06, verificar documentación) de `docs/plan_desarrollo.md`.
- Nombre del sistema e integrantes: se usan los de la Segunda Entrega.
- **Pendientes de definición** — **resueltos en la auditoría**: 1→DA-04, 2→DA-02, 3→DA-03, 4→DA-13, 5→DA-09, 6→DA-20, 7→DA-21, 8→DA-11. Texto original:
  1. Correo del colaborador: Colaborador solo tiene `nombre`, pero recibe 4 correos (HU-07, HU-22, HU-23, HU-24).
  2. Cómo reconoce el sistema al auxiliar para la restricción de la epicrisis (HU-02).
  3. Cómo se cargan los catálogos de entidades (con sus plazos) y de colaboradores: no hay caso de uso para administrarlos (HU-03, HU-09, HU-12).
  4. Fecha desde la que corre cada plazo de alerta, umbral de «por vencer» y festivos para días hábiles (HU-08, HU-12).
  5. Fórmula del valor diario del IBC y si aplica igual a ARL y licencias (HU-21).
  6. Filtros de la consulta de estados (HU-11).
  7. Contenido (columnas) del reporte de ausentismo (HU-27).
  8. Cómo se sabe que el pago de una incapacidad está «identificado y conciliado» (HU-29).

## 18. Instrucciones para la IA que ayude a programar

1. Lee este archivo antes de crear o modificar código importante.
2. Respeta las decisiones ya tomadas: arquitectura MVC con Persistencia, una clase por capa, 14 grupos, Node.js + Express + EJS, Supabase y SMTP.
3. No inventes requisitos, entidades, campos, estados, procesos, pantallas, roles ni funcionalidades que no estén en este archivo.
4. Usa los nombres de clases, atributos y operaciones definidos aquí.
5. No cambies el comportamiento definido (estados, reglas, plazos, porcentajes) sin una justificación aprobada por el equipo.
6. Si una tarea depende de un pendiente de la sección 17, detente y pregunta; no lo resuelvas con una suposición.
7. Pregunta antes de cualquier decisión que cambie cómo funciona el sistema o su estructura.
8. Mantén el código coherente con los requisitos y el diseño: si encuentras una contradicción, señálala en lugar de corregirla en silencio.
9. Trabaja solo en el módulo en curso (sección 16). No adelantes código de módulos siguientes ni cambies uno ya cerrado sin avisar.
10. Al terminar un módulo, verifica uno por uno los criterios de aceptación de sus historias y actualiza la sección 17 con el módulo cerrado.
