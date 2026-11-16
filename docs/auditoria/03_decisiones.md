# 03 · Decisiones sobre los hallazgos de la auditoría — SIGI

> Fecha: 2026-11-16. El usuario aceptó todas las recomendaciones propuestas para los hallazgos de `02_hallazgos.md`.
> **Origen:** «Doc.» = respaldada por la documentación existente · «Nueva» = decisión del equipo que la documentación no define. Conviene validar las nuevas con el equipo o el profesor.

| ID | Hallazgo | Decisión | Origen | Afecta a |
| --- | --- | --- | --- | --- |
| DA-01 | H-01 | `registrarRadicacion` guarda la radicación **y** pone `estado = transcrita` (también en una nueva radicación tras un rechazo). Se mantiene el nombre «transcrita», que significa «presentada a la entidad». | Doc. (HU-10, EST-01) | HU-10, 13, 14; grupo `radicacion` |
| DA-02 | H-03, P-2 | **Usuarios y permisos (actualizada 2026-11-16).** (a) Tabla de usuarios con un **rol** por usuario. (b) **Permisos por actor:** cada operación de la Vista solo la ejecuta el actor que la envía en su diagrama de secuencia (ver la tabla «Permisos por rol» más abajo); la historia clínica y la epicrisis, solo el auxiliar (HU-02). (c) **Usuarios de demostración:** 10 usuarios ficticios, 2 por cada uno de los 5 roles que usan pantallas (personal receptor, líder, auxiliar, Contabilidad y Tesorería, Cartera y Jurídica), con dominio reservado `.test` (por ejemplo, `auxiliar1@sigi.test`). Se crean con un script inicial en Supabase Auth, ya confirmados; las contraseñas van en `.env`, que no se sube al repositorio. (d) Coordinación, SG-SST y Gestión Documental **no tienen cuenta**: solo reciben correos. (e) En la demostración los correos se ven en **Mailpit** (servidor SMTP local con bandeja web); en producción solo cambia la configuración SMTP. | Doc. (actor de cada DS) + Nueva (tabla de roles, usuarios ficticios, Mailpit). F3 §14 decía que no había permisos por rol; esta decisión lo cambia. | HU-01, HU-02 y todas las HU con pantalla |
| DA-03 | P-3 | Las entidades y sus plazos se cargan con un **script inicial (seed)** con los datos del procedimiento §5.2.1, sin pantalla. Los colaboradores **se crean al registrar la incapacidad** si no existen. No se agrega ningún CU. | Nueva | HU-03, 09, 12 |
| DA-04 | P-1 | Se agrega el atributo `correo` a Colaborador. No se agrega la identificación. | Nueva (necesaria) | HU-07, 22, 23, 24 |
| DA-05 | H-02 | El cobro persuasivo y jurídico se aplica **solo a las cobradas con demora**. Una rechazada solo vuelve a radicarse. (Se anota para la entrega: corregir el «o rechazo» de CU-12 y HU-18.) | Doc. (EST-01, AD-01, HU-14) | HU-18, 19 |
| DA-06 | H-04 | Se agrega una operación para **ver o descargar un documento** en el grupo `verificacion`. El archivo lo entrega el servidor, nunca el navegador desde el bucket directamente. Valores de Documento.tipo: soporte de incapacidad, epicrisis o documento soporte, historia clínica, FURIPS, certificado de nacido vivo, registro civil, documento de identidad. | Nueva (necesaria para HU-02) | HU-02 |
| DA-07 | H-08 | El segundo llamado es **manual**: lo registra el auxiliar. Cumplirse los 3 días hábiles aparece como alerta (HU-12). | Doc. (CU-05, DS-03, HU-08) | HU-08, 12 |
| DA-08 | H-12 | Cualquier pago registrado deja la incapacidad en **pagada**. Se pueden registrar más pagos después. | Doc. (DS-06/07/08, EST-01) | HU-15 |
| DA-09 | H-05, P-5 | IBC diario = IBC ÷ 30. `valorEmpresa` = días 1–2 × 100 %. `valorEPS` = (días 3–90 × 67 %) + (días 91–180 × 50 %). Se aplica igual a ARL y licencias. **Es una suposición marcada en el código.** | Nueva (validar) | HU-21 |
| DA-10 | H-06 | Se agrega el atributo `tramitePension` (sí/no) a Incapacidad; lo guarda `guardarCalculo`. | Nueva (necesaria) | HU-21 |
| DA-11 | H-23, P-8 | En `identificarPagos`, el auxiliar **selecciona** los pagos registrados de la entidad. Un pago consignado queda identificado si coinciden colaborador y valor. Una incapacidad queda conciliada cuando su pago se identificó en una conciliación (marca `conciliado` en Pago). | Nueva (validar) | HU-26, HU-29 |
| DA-12 | H-17 | Al archivar se elimina **solo la epicrisis**. El correo a Gestión Documental lleva **solo los datos**, sin adjuntos. | Doc. (Visión, CAR-11) + Nueva (sin adjuntos) | HU-29 |
| DA-13 | P-4 | Fechas de inicio: envío = de `fechaInicio` a `fechaRecepcion` (2 días); subsanación = desde `fechaAvisoFaltantes` (3 días hábiles); transcripción = `fechaInicio` + plazo de la entidad; paternidad = `fechaNacimiento` + 30 días; hitos 90/120/150/180 desde `fechaInicio`. «Por vencer» = 5 días antes del vencimiento. Festivos de Colombia en una lista fija. Se agregan `fechaAvisoFaltantes` y `fechaNacimiento` a Incapacidad. | Nueva (validar) | HU-07, 08, 12 |
| DA-14 | H-09, H-13 | Radicar sin verificar y trasladar a Cartera con menos de 2 requerimientos: **se advierte y se permite**. Los «180 días» son el motivo que escribe el auxiliar. | Doc. (D-10) | HU-09, 18, 19 |
| DA-15 | H-10 | Se agrega `idIncapacidad` a las operaciones que no lo tienen, sin cambiar sus nombres. | Necesaria | Varias |
| DA-16 | H-11 | La fecha del pago la escribe el auxiliar: `registrarPago(idIncapacidad, valor, fechaPago)`. | Doc. (HU-15) | HU-15 |
| DA-17 | H-15 | `datosRadicacion` devuelve la entidad, el plazo, el estado del plazo (al día / por vencer / vencido) y `permiteTranscripcionDigital`. | Doc. (HU-09) | HU-09 |
| DA-18 | H-14 | Las incapacidades con `decision = dar de baja` no aparecen en los pendientes de pago. No se agrega ningún estado. | Nueva | HU-16, 20 |
| DA-19 | H-16 | `consultarReporteProlongadas` (DS-10) calcula en el momento. `generarReporte(prolongadas)` (DS-12) guarda el reporte mensual. | Doc. (HU-22) | HU-22, 28 |
| DA-20 | P-6 | Filtros de la consulta de estados: estado (incluido «sin valor»), entidad, colaborador y rango de fechas de inicio. | Nueva | HU-11 |
| DA-21 | P-7 | Reporte de ausentismo: colaborador, tipo, entidad, fechaInicio, días y estado. Se guarda con su contenido (se agrega el atributo `contenido` a Reporte). **Validar con el equipo.** | Nueva (validar) | HU-27 |
| DA-22 | H-22 | HU-12 no se divide; se escribe un test por cada tipo de plazo. HU-05: un segundo registro **reemplaza** al reemplazo anterior. | Nueva | HU-05, 12 |
| DA-23 | H-07 | Cada registro guarda el usuario que lo hizo y la fecha (auditoría mínima, apoya OBN-4). | Nueva | Todas |
| DA-24 | H-19, H-21 | Vale el diagrama de casos de uso del PDF. Los `.drawio` se toman como equivalentes al PDF y sirven de fuente. | Usuario | — |
| DA-25 | H-18, H-20 | Solo se informan; no afectan el código. | — | — |

## Atributos nuevos en el modelo (derivados de las decisiones)

| Clase | Atributo | Decisión |
| --- | --- | --- |
| Colaborador | correo | DA-04 |
| Incapacidad | tramitePension, fechaAvisoFaltantes, fechaNacimiento | DA-10, DA-13 |
| Pago | conciliado | DA-11 |
| Reporte | contenido | DA-21 |
| (nueva tabla técnica) Usuario | correo, rol | DA-02 |
| Todas las tablas | creadoPor, creadoEn | DA-23 |

## Permisos por rol (DA-02)

Cada operación de la Vista está asignada al actor que la envía en su diagrama de secuencia.

| Rol | Operaciones de la Vista | Fuente |
| --- | --- | --- |
| Personal receptor | registrarIncapacidad, registrarDocumentos | DS-01 |
| Líder / Jefe inmediato | registrarReemplazo | DS-02 |
| Auxiliar de Administración de Personal | registrarIncapacidad, registrarDocumentos (canal correo); verificarDocumentacion, confirmarVerificacion, notificarFaltantes, registrarSegundoLlamado, ver documento (DA-06); prepararRadicacion, registrarRadicacion; consultarEstados; consultarAlertas; registrarCobrada, registrarRechazo, registrarPago; consultarPendientesDePago, registrarSeguimiento, registrarAcuerdo; registrarRequerimiento, trasladarACartera; calcularReconocimiento; consultarReporteProlongadas, registrarConcepto, registrarFaltaConcepto, registrarSuspensionPago; identificarPagos; generarReporte; consultarPagadas, archivarIncapacidad, registrarEnvioArchivo | DS-01, DS-03 a DS-14 |
| Contabilidad y Tesorería | registrarPagosConsignados | DS-11 |
| Cartera y Jurídica | registrarDecision | DS-08 |
| Coordinación, SG-SST, Gestión Documental | Sin cuenta: solo reciben correos | DS-03, DS-07, DS-12, DS-13 |

Usuarios de demostración: `receptor1`, `receptor2`, `lider1`, `lider2`, `auxiliar1`, `auxiliar2`, `contabilidad1`, `contabilidad2`, `cartera1`, `cartera2` (todos `@sigi.test`). Los colaboradores ficticios y los destinatarios de las notificaciones (Coordinación, SG-SST, Gestión Documental) también usan correos `@sigi.test`, que se ven en Mailpit.
