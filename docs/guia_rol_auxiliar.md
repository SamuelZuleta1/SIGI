# Guía del rol Auxiliar de Administración de Personal en SIGI

**Rol en el sistema:** `auxiliar` · **Nombre para mostrar:** «Auxiliar de Administración de Personal»
**Cuenta de demostración:** `auxiliar1@sigi.test` (acceso rápido en el inicio de sesión, si `DEMO_PASSWORD` está definida).
**Alcance:** este documento describe el comportamiento implementado en el código (`codigo/src/config/permisos.js`, `codigo/src/routes/`, `codigo/src/controllers/`). Donde el diseño y el código difieren, se indica.

---

## 1. Resumen del rol

El auxiliar es el **usuario principal de SIGI**. Es el único rol que puede:

- Ver la **historia clínica** y la **epicrisis** de un colaborador (HU-02, CAR-11).
- Verificar la documentación, radicar, cobrar, hacer seguimiento, calcular el reconocimiento, monitorear prolongadas, conciliar pagos, generar reportes y archivar.

Tiene **30 operaciones** en total, más que cualquier otro rol. Los demás roles tienen rutas propias:

| Rol | Qué hace | Operaciones |
| --- | --- | --- |
| Personal receptor | Registra la incapacidad y los documentos que llegan a recepción | 2 |
| Líder / Jefe inmediato | Registra reemplazos | 1 |
| **Auxiliar** | **Todo lo demás del ciclo de la incapacidad** | **30** |
| Contabilidad y Tesorería | Registra pagos consignados por las entidades y anula los suyos | 2 |
| Cartera y Jurídica | Decide sobre el cobro trasladado | 1 |

El auxiliar **no** puede registrar pagos consignados (eso es de Contabilidad), ni registrar reemplazos (eso es del líder), ni decidir sobre un traslado (eso es de Cartera y Jurídica).

---

## 2. Inicio de sesión y permisos

1. Entra con su correo institucional y contraseña (HU-01). Sin sesión válida, el middleware rechaza cualquier petición.
2. El sistema lee el rol del usuario y muestra solo las pantallas de su rol. Cada operación se valida **también en el servidor**: aunque el auxiliar escriba una dirección a mano, la petición se rechaza si el rol no tiene esa operación.
3. Los enlaces del menú se muestran según `puede(operacion)` (`codigo/src/app.js`).

**Regla de documentos reservados** (`puedeVerDocumento`, `codigo/src/config/permisos.js`):

- La **historia clínica** y la **epicrisis** solo las ve el auxiliar. Si otro rol intenta abrirlas, no se le muestran.
- Los demás documentos los pueden ver los roles que tengan `verDocumento`, que es solo el auxiliar en la práctica.
- Los archivos se abren con un **enlace firmado de 60 segundos** (DA-71). El navegador nunca accede al bucket directamente.

---

## 3. Mapa del menú y pantallas

| Menú | Ruta | Operaciones que habilita | Para qué sirve |
| --- | --- | --- | --- |
| Inicio | `/` | — | Pantalla de bienvenida con el rol |
| Registrar incapacidad | `/incapacidades/nueva` | `registrarIncapacidad` | Registrar una incapacidad llegada por correo |
| Prórroga | `/incapacidades/prorroga` | `registrarIncapacidad` | Registrar la continuación de una incapacidad |
| Documentos | `/documentos` | `registrarDocumentos` | Registrar los documentos llegados por correo |
| Verificación | `/verificacion` | `verificarDocumentacion` | Revisar documentos completos o faltantes |
| Radicación | `/radicacion` | `prepararRadicacion` | Preparar y registrar la transcripción a la entidad |
| Estados | `/estados` | `consultarEstados` | Consultar el estado de cada incapacidad |
| Alertas | `/alertas` | `consultarAlertas` | Plazos por vencer y vencidos |
| Cobro | `/cobro` | `registrarCobrada` | Registrar cobrada o rechazada, y el pago |
| Seguimiento | `/seguimiento` | `consultarPendientesDePago` | Seguimiento semanal de cobradas pendientes de pago |
| Cartera | `/cartera` | Solo rol `cartera` (`registrarDecision`) | **No es del auxiliar** |
| Reconocimiento | `/reconocimiento` | `calcularReconocimiento` | Calcular el IBC y los valores EPS / empresa |
| Prolongadas | `/prolongadas` | `consultarReporteProlongadas` | Monitoreo de incapacidades largas |
| Conciliación | `/conciliacion` | `identificarPagos` | Identificar pagos consignados y conciliar |
| Reportes | `/reportes` | `generarReporte` | Ausentismo y prolongadas |
| Archivo | `/archivo` | `consultarPagadas` | Archivar incapacidades pagadas y enviarlas a Gestión Documental |

> Nota: el menú muestra solo los enlaces que el rol puede usar. Los enlaces de «Cartera», «Pagos consignados» y «Reemplazo» son de otros roles; el auxiliar no tiene acceso a ellos y, si escribe la dirección a mano, el servidor responde con prohibido.

---

## 4. Operaciones del auxiliar (30)

Agrupadas por el flujo de la incapacidad. La columna «Ruta» indica el método y la dirección del servidor.

### 4.1 Ingreso de la incapacidad y sus documentos (canal correo)

| Operación | Ruta | Qué hace |
| --- | --- | --- |
| `registrarIncapacidad` | `POST /incapacidades` | Crea la incapacidad con colaborador, tipo, entidad, fecha de inicio, días y fecha de recepción. Queda en estado «registrada» sin valor. |
| `registrarIncapacidad` (prórroga) | `POST /incapacidades/prorroga` | Registra la prórroga de una incapacidad existente. |
| `registrarDocumentos` | `POST /incapacidades/:id/documentos` | Guarda cada documento con su tipo y su archivo. Si llegó por correo, marca el **original en físico como pendiente**. |
| `verDocumento` | `GET /documentos/:id/archivo` | Abre un documento con enlace firmado de 60 s. Es la única forma de ver la historia clínica y la epicrisis. |

**Reglas:**
- Si la incapacidad llega por recepción, la registra el personal receptor. Si llega por correo, la registra el auxiliar.
- Los tipos de documento son: soporte de la incapacidad, epicrisis o documento soporte, historia clínica, FURIPS, certificado de nacido vivo, registro civil y documento de identidad.
- Al registrar documentos se avisa por correo al auxiliar (si lo hace el receptor). Si el auxiliar los registra, el sistema guarda y muestra la confirmación.

### 4.2 Verificación de la documentación

| Operación | Ruta | Qué hace |
| --- | --- | --- |
| `verificarDocumentacion` | `GET /verificacion` y `GET /incapacidades/:id/verificacion` | Muestra el estado de documentos obligatorios, faltantes y avisos. |
| `notificarFaltantes` | `POST /incapacidades/:id/faltantes` | Marca los documentos faltantes, envía correo al colaborador con **plazo de 3 días hábiles** y guarda el aviso. |
| `registrarSegundoLlamado` | `POST /incapacidades/:id/segundo-llamado` | Registra el segundo llamado y avisa a la Coordinación. |
| `confirmarVerificacion` | `POST /incapacidades/:id/verificacion` | Si la documentación está completa, la **archiva en digital**. |

**Reglas implementadas (`verificacion.controller.js`):**

- Para notificar faltantes hay que marcar **al menos un documento** de la lista de tipos.
- Si la documentación ya está archivada, no se notifican faltantes.
- Si la documentación está completa, no hay faltantes que notificar.
- **Con un aviso pendiente no se notifica de nuevo** hasta que lleguen documentos (DA-31).
- **Primero se envía el correo y después se registra el aviso**. Si el correo falla, el aviso no se guarda y el auxiliar puede intentarlo otra vez.
- El **segundo llamado** solo se puede registrar cuando el aviso está **vencido** (después de 3 días hábiles). Un aviso nuevo permite otro segundo llamado (DA-33).
- Si el segundo llamado ya se registró para ese aviso, no se repite.
- Para archivar en digital, deben estar **todos los documentos obligatorios**; si faltan, el sistema muestra «Faltan documentos obligatorios: la documentación no se archivó».

### 4.3 Radicación (transcripción a la entidad)

| Operación | Ruta | Qué hace |
| --- | --- | --- |
| `prepararRadicacion` | `GET /radicacion`, `GET /incapacidades/:id/radicacion`, `GET /radicaciones/:id/evidencia` | Muestra la entidad, el plazo de radicación y la alerta. |
| `registrarRadicacion` | `POST /incapacidades/:id/radicacion` | Guarda el número de radicado y la evidencia. La incapacidad pasa a **transcrita**. |

**Reglas:**
- El plazo depende de la entidad (procedimiento §5.2.1). Ejemplos: Salud Total 12 meses (accidentes de tránsito 15 días), Nueva EPS 12 meses, SOS 12 meses, Sanitas 3 años, SURA EPS 150 días calendario, Asmet Salud 12 meses, ARL SURA 12 meses.
- Licencia de paternidad: 30 días calendario desde el nacimiento, en todas las EPS. Si no hay fecha de nacimiento, se cuenta desde el inicio de la licencia (DA-35).
- Una alerta es **«por vencer»** cuando faltan 5 días calendario o menos (DA-13).
- **No se puede radicar** si la incapacidad tiene un motivo de traslado a Cartera, o si su estado no es «registrada» ni «rechazada». Desde «rechazada», una nueva radicación la devuelve a «transcrita».
- Las alertas **no bloquean** la operación: informan.
- Las entidades SOS, Sanitas y Famisanar exigen transcripción por correo y con personal de la entidad.

### 4.4 Estados y alertas

| Operación | Ruta | Qué hace |
| --- | --- | --- |
| `consultarEstados` | `GET /estados` | Lista las incapacidades con filtros. Solo lectura. |
| `consultarAlertas` | `GET /alertas` | Muestra plazos por vencer y vencidos. |

### 4.5 Cobro: cobrada, rechazada y pago

| Operación | Ruta | Qué hace |
| --- | --- | --- |
| `registrarCobrada` | `GET /cobro`, `GET /incapacidades/:id/cobro`, `POST /incapacidades/:id/cobro` | Estado → **cobrada**. Guarda el tiempo de pago prometido por la entidad y la fecha de cobro. |
| `registrarRechazo` | `POST /incapacidades/:id/rechazo` | Estado → **rechazada**. Guarda la causal (texto obligatorio). |
| `registrarPago` | `POST /incapacidades/:id/pago` | Registra un pago con valor y fecha. Estado → **pagada**. |
| `anularPago` | `POST /incapacidades/:id/pagos/:idPago/anulacion` | Anula un pago mal digitado. No lo borra. |

**Reglas:**
- **Registrar cobrada:** solo desde «transcrita». El tiempo de pago es en días calendario.
- **Registrar rechazo:** solo desde «transcrita». La causal es obligatoria (texto libre; el sistema la valida antes de guardar).
- **Registrar pago:** desde «cobrada» o «pagada». Solo si el archivo **no** está preparado.
- **Anular pago:** el motivo tiene entre **10 y 500 caracteres**. No se puede anular si:
  - el pago ya está anulado;
  - el pago ya se identificó en una conciliación;
  - el archivo de la incapacidad ya está preparado.
- Los valores se leen como cifras en pesos. Se rechazan valores vacíos, con formato no válido, demasiado grandes o en cero.

### 4.6 Seguimiento del cobro

| Operación | Ruta | Qué hace |
| --- | --- | --- |
| `consultarPendientesDePago` | `GET /seguimiento` | Lista las incapacidades cobradas pendientes de pago (seguimiento semanal). |
| `registrarSeguimiento` | `POST /incapacidades/:id/seguimiento` · `GET /seguimientos/:id/evidencia` | Guarda el seguimiento con evidencia. Evalúa si hay demora. |
| `registrarAcuerdo` | `POST /incapacidades/:id/acuerdo` | Registra el acuerdo de pago con fecha y valor. |

**Regla de demora (`evaluarDemora`):**
- La fecha prometida es `fecha de cobro + tiempo de pago`.
- Si hoy es posterior a la fecha prometida, hay **demora**: el sistema envía aviso de retraso a la Coordinación.
- **Si el correo falla, no se guarda el seguimiento.** Se muestra un error y el auxiliar puede intentarlo de nuevo (DA-42).
- Solo se puede registrar seguimiento o acuerdo si la incapacidad está **pendiente de pago**.

### 4.7 Cobro persuasivo y traslado a Cartera y Jurídica

| Operación | Ruta | Qué hace |
| --- | --- | --- |
| `registrarRequerimiento` | `GET /incapacidades/:id/requerimientos`, `POST /incapacidades/:id/requerimiento` | Registra un requerimiento de cobro con sus fundamentos. |
| `trasladarACartera` | `POST /incapacidades/:id/traslado` | Traslada la incapacidad a Cartera y Jurídica con motivo. Envía correo a Cartera. |

**Reglas:**
- Se necesitan **al menos 2 requerimientos** para trasladar (`REQUERIMIENTOS_MINIMOS = 2`).
- Causales del traslado (`impedimentoDeCausal`):
  - **Rechazo de la entidad:** solo si la incapacidad está «rechazada».
  - **180 días sin pago:** solo si la incapacidad está «cobrada» y pasaron 180 días desde la fecha de cobro. Si no, el sistema indica desde qué fecha se puede.
  - **Deterioro crediticio de la entidad:** solo si la incapacidad está «cobrada».
- Una vez trasladada, la incapacidad ya no admite requerimientos ni seguimiento del auxiliar.
- Cartera y Jurídica decide después (recuperar o dar de baja). Esa decisión **no** la toma el auxiliar.

### 4.8 Reconocimiento económico (IBC)

| Operación | Ruta | Qué hace |
| --- | --- | --- |
| `calcularReconocimiento` | `GET /reconocimiento`, `GET /incapacidades/:id/reconocimiento`, `POST /incapacidades/:id/reconocimiento`, `GET /incapacidades/:id/reconocimiento/detalle` | Ingresa el IBC y obtiene el cálculo por tramos. |

**Reglas:**
- El IBC lo ingresa el **auxiliar al calcular**, no al registrar la incapacidad.
- Tramos:
  - **Días 1 y 2:** 100 % del IBC, a cargo de la empresa.
  - **Días 3 a 90:** 67 % del IBC, a cargo de la EPS.
  - **Días 91 a 180:** 50 % del IBC, a cargo de la EPS.
  - **Desde el día 181:** se marca el **trámite de pensión** (el colaborador tramita ante el fondo o la EPS).
- Si la incapacidad está **pagada**, no se recalcula (DA-53).
- En la versión de la rama `feat/mejoras-flujo-documentos-y-listas` (DA-72), el cálculo también se hace **en la fila** de la lista, y «Ver tramos» muestra el detalle.

### 4.9 Monitoreo de incapacidades prolongadas

| Operación | Ruta | Qué hace |
| --- | --- | --- |
| `consultarReporteProlongadas` | `GET /prolongadas`, `GET /incapacidades/:id/prolongada` | Lista las incapacidades prolongadas (más de 90 días) con sus hitos. |
| `registrarConcepto` | `POST /incapacidades/:id/concepto` | Registra el concepto de rehabilitación. Envía correo al colaborador. |
| `registrarFaltaConcepto` | `POST /incapacidades/:id/falta-concepto` | Registra que la entidad no emitió el concepto. Avisa al colaborador. |
| `registrarSuspensionPago` | `POST /incapacidades/:id/suspension-pago` | Registra la suspensión del pago a los 180 días. Notifica al colaborador. |

**Hitos:** 90, 120, 150 y 180 días.
- **Día 120:** se solicita el concepto de rehabilitación. El envío a la AFP lo hace el auxiliar **fuera del sistema**.
- **Día 180:** se registra la suspensión del pago.
- Si la incapacidad tiene **prórroga**, el concepto, la falta o la suspensión se registran en la prórroga (el sistema lo indica).
- Si la incapacidad no es prolongada o aún no llega al día que corresponde, el sistema explica por qué no se puede registrar.

### 4.10 Conciliación de pagos consignados

| Operación | Ruta | Qué hace |
| --- | --- | --- |
| `identificarPagos` | `GET /conciliacion`, `GET /conciliacion/:id`, `POST /conciliacion` | Elige una entidad, revisa los pagos consignados por identificar y los concilia. |

**Flujo:**
1. Contabilidad registra los pagos consignados del mes (`registrarPagosConsignados`, no del auxiliar). Al hacerlo, el sistema avisa por correo al auxiliar que hay pagos por identificar.
2. El auxiliar elige **una entidad** (una lista es de una sola entidad, DA-55).
3. Marca los pagos consignados que corresponden a los pagos de la entidad.
4. Al conciliar:
   - los pagos identificados quedan conciliados y el **detalle se envía a Contabilidad**;
   - si quedan pagos sin identificar, se envían **saldos pendientes** a Contabilidad.

**Reglas:**
- Si la entidad no tiene pagos por identificar, el sistema lo indica y no concilia.
- Si un pago ya se concilió o no es de esa entidad, se muestra «Revise la lista».
- Si los pagos cambian mientras el auxiliar revisa (otra persona concilió), se responde con conflicto y debe revisar otra vez.
- En la rama DA-72, al elegir la entidad, los pagos se cargan solos y el teclado no cambia la entidad sin confirmar.

> El auxiliar **no** anula pagos consignados: esa operación es de Contabilidad (`anularPagoConsignado`).

### 4.11 Reportes

| Operación | Ruta | Qué hace |
| --- | --- | --- |
| `generarReporte` | `GET /reportes`, `POST /reportes/ausentismo`, `POST /reportes/prolongadas`, `GET /reportes/:id` | Genera el reporte de ausentismo (para SG-SST) o el mensual de prolongadas (por hito). |

**Reglas:**
- **Ausentismo:** se entrega al SG-SST en los **primeros 3 días de cada mes**. Se envía por correo.
- **Prolongadas:** reporte mensual clasificado por hito.
- Si en el periodo no hay datos, el sistema responde «No hay [datos] en [periodo]: no se generó el reporte» y no crea nada.

### 4.12 Archivo y envío a Gestión Documental

| Operación | Ruta | Qué hace |
| --- | --- | --- |
| `consultarPagadas` | `GET /archivo`, `GET /incapacidades/:id/archivo` | Lista las incapacidades pagadas y su estado de archivo. |
| `archivarIncapacidad` | `POST /incapacidades/:id/archivo` | Prepara el archivo: **elimina la epicrisis** y deja la incapacidad lista para enviar. |
| `registrarEnvioArchivo` | `POST /incapacidades/:id/archivo/envio` | Envía la incapacidad a Gestión Documental (correo) y la marca como enviada. |

**Reglas:**
- Solo se archiva una incapacidad **pagada**, con el **pago identificado y conciliado**. Si no, el sistema advierte y no envía.
- Al preparar el archivo se **elimina la epicrisis** (dato reservado). Si la eliminación falla, no se envía el correo.
- Si el correo a Gestión Documental falla, el sistema muestra el error y permite reintentar.
- Una incapacidad enviada o con archivo ya preparado no se vuelve a preparar.

---

## 5. Flujo completo de una incapacidad

```
Registrada ──► Documentos ──► Verificación ──► Radicación ──► Transcrita
   (correo)     (original         (completa:     (radicado +      │
                 pendiente)        archiva en     evidencia)      │
                                   digital;                       ▼
                                   faltantes →              Cobrada ──► Pagada ──► Conciliada ──► Archivo ──► Gestión Documental
                                   3 días hábiles →            │   ▲       │                       (fin)
                                   segundo llamado)            │   │       │
                                                               │   └─ seguimiento semanal
                                                               ▼
                                                           Rechazada ──► (nueva radicación) ──► Transcrita
                                                               │
                                                               ▼
                                                    Requerimientos (≥ 2) ──► Traslado a Cartera y Jurídica
                                                                                     (fuera del auxiliar: decisión de Cartera)

Paralelo, si la incapacidad supera 90 días: monitoreo de prolongadas
  día 120 → concepto  |  falta de concepto  |  día 180 → suspensión del pago
Paralelo: reconocimiento económico (IBC) y reportes mensuales
```

---

## 6. Casos de uso y ejemplos

### Caso 1: incapacidad llegada por correo, documentación completa
1. **Registrar incapacidad** (`/incapacidades/nueva`): colaborador, tipo, entidad, fecha de inicio, días y fecha de recepción.
2. **Registrar documentos** (`/documentos`): los documentos; el original queda pendiente.
3. **Verificar** (`/verificacion`): si todo está completo, **confirmar verificación** → archivada en digital.
4. **Radicar** (`/radicacion`): número de radicado y evidencia → **transcrita**.
5. **Registrar cobrada** (`/cobro`): tiempo de pago prometido → **cobrada**.
6. **Registrar pago** → **pagada**.
7. **Conciliar** (`/conciliacion`) cuando Contabilidad registró los pagos consignados.
8. **Archivar** (`/archivo`): prepara el archivo, elimina la epicrisis; luego **enviar a Gestión Documental**.

### Caso 2: faltan documentos
1. **Verificar** → marcar los faltantes → **notificar faltantes** → correo al colaborador con 3 días hábiles.
2. Si el colaborador no entrega en el plazo, **registrar segundo llamado** (solo después de vencido el aviso). Avisa a la Coordinación.
3. Si llegan los documentos, se registran y se vuelve a verificar.

### Caso 3: rechazo de la entidad
1. Desde la incapacidad **transcrita**, **registrar rechazo** con la causal → **rechazada**.
2. **Radicar de nuevo** → **transcrita**. Luego cobrar como en el caso 1.

### Caso 4: pago demorado
1. **Seguimiento** (`/seguimiento`): la incapacidad cobrada aparece en la lista.
2. Se registra el seguimiento. Si pasó el tiempo prometido, se avisa a la Coordinación (si el correo falla, no se guarda; reintentar).
3. Registrar el **acuerdo** con fecha y valor.

### Caso 5: cobro persuasivo y traslado
1. Registrar **dos requerimientos** con sus fundamentos.
2. **Trasladar** con motivo. Causal válida según el estado (rechazo, 180 días o deterioro).
3. Cartera y Jurídica decide. El auxiliar ya no puede seguir gestionando esa incapacidad.

### Caso 6: pago mal digitado
1. En la incapacidad, **anular pago** con un motivo de 10 a 500 caracteres.
2. Si ese pago ya se concilió o el archivo está preparado, **no se puede anular**. El sistema lo indica.
3. Volver a registrar el pago correcto.

### Caso 7: incapacidad prolongada
1. Entre 90 y 120 días: aparece en **Prolongadas**.
2. Día 120: **registrar concepto** (correo al colaborador). Si la entidad no lo emitió, **registrar falta del concepto**.
3. Día 180: **registrar suspensión del pago** (correo al colaborador).

### Caso 8: cierre mensual
1. **Reconocimiento:** ingresar IBC y calcular tramos (en la fila o en la pantalla completa).
2. **Conciliación:** elegir la entidad, identificar pagos y conciliar. Se envía el detalle a Contabilidad.
3. **Reportes:** generar ausentismo (antes del día 3 del mes) y prolongadas por hito.

---

## 7. Posibles errores y cómo se resuelven

| Situación | Mensaje o efecto | Qué hacer |
| --- | --- | --- |
| No hay incapacidad con ese número | «No hay una incapacidad con ese número.» | Revisar el número. |
| Registrar cobrada cuando no está transcrita | «La incapacidad no admite registrarse como cobrada» (según el estado) | Radicar primero. |
| Radicar una incapacidad con traslado | «Ya fue trasladada a Cartera y Jurídica» | No se puede; la gestiona Cartera. |
| Notificar faltantes con aviso pendiente | Aviso pendiente, no se repite | Esperar a que el colaborador entregue o a que venza el plazo. |
| Segundo llamado antes de vencer | «Podrá registrar el segundo llamado desde el [fecha]» | Esperar la fecha indicada. |
| Correo no enviado (faltantes, retraso, concepto, traslado, archivo) | Error; no se guarda nada | Reintentar. El sistema no deja registros a medias. |
| Conciliación: pagos cambiaron | «Los pagos de esta entidad cambiaron mientras los revisaba» | Revisar la lista y volver a conciliar. |
| Anular pago conciliado o con archivo preparado | «Este pago ya se identificó…» / «El archivo… ya está preparado» | No se puede anular; coordinar con Contabilidad si hay error. |
| Motivo de anulación corto o largo | «Escriba el motivo con al menos 10 caracteres» | Ajustar el texto. |
| Reporte sin datos en el periodo | «No hay [datos] en [periodo]» | Revisar el periodo. |
| Archivo sin conciliar | Advierte y no envía | Conciliar primero. |
| Sesión vencida en una petición JSON | Respuesta 401 (la fila de reconocimiento lo muestra y pide iniciar sesión) | Volver a iniciar sesión. |

---

## 8. Límites del rol (lo que el auxiliar NO hace)

- No registra **pagos consignados** (Contabilidad).
- No anula **pagos consignados** (Contabilidad).
- No registra **reemplazos** (líder).
- No decide sobre el **cobro trasladado** (Cartera y Jurídica).
- No envía el concepto a la AFP dentro del sistema (fuera de SIGI).
- No tramita el cobro jurídico (derecho de petición o tutela): se hace fuera del sistema; SIGI solo registra la decisión de Cartera.

---

## 9. Reglas transversales

- **Alertas:** informan, nunca bloquean.
- **Correo antes que registro:** en los avisos a colaboradores o a Coordinación, si el correo falla no se guarda el registro. Así no queda un aviso que nadie recibió.
- **Auditoría:** los pagos se anulan (no se borran) para conservar el historial.
- **Concurrencia:** si dos personas operan la misma incapacidad a la vez, el sistema lo detecta y pide revisar el resultado (mensajes «Otro usuario registró…»).
- **Datos reservados:** la historia clínica y la epicrisis solo se ven con el rol auxiliar, y se abren con enlace firmado de 60 s.

---

## 10. Pendientes o cambios de la rama actual

| Tema | Estado |
| --- | --- |
| Mejoras de flujo de documentos, reconocimiento en la fila y conciliación al elegir la entidad (DA-72) | En PR #7 contra `main`, pendiente de revisión y merge |
| Medir en producción el tiempo de registrar varios documentos (DA-71) | Pendiente de medición |
| Anulación de pagos (HU-15), requerimientos y traslado (HU-18, HU-19) | Implementados; cambios de auditoría ya fusionados en `main` (PR #3 a #5) |

---

*Documento generado a partir del código de la rama `feat/mejoras-flujo-documentos-y-listas`. Si cambian las reglas de negocio, actualizar primero `docs/contexto/CONTEXTO_PROYECTO.md` y después esta guía.*
