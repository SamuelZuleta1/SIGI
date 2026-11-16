# Historias de Usuario – SIGI

Nov 13, 2026 · @Juan Jose

## Resumen de módulos

SIGI tiene 12 módulos y 30 historias de usuario, tomados de los 17 casos de uso y de la Visión y Alcance. Cada módulo corresponde a un grupo de código de la estructura MVC (carpetas `routes/`, `views/`, `controllers/` y `persistence/`).

| Módulo | Objetivo | Historias | Grupo de código | Prioridad |
| --- | --- | --- | --- | --- |
| 1. Acceso y seguridad | Iniciar sesión y proteger la epicrisis | HU-01 a HU-02 | `middleware/autenticacion.js` | Alta |
| 2. Registro y recepción | Registrar la incapacidad, sus documentos y el reemplazo | HU-03 a HU-05 | `registro`, `reemplazo` | Alta |
| 3. Verificación documental | Verificar los documentos y avisar faltantes | HU-06 a HU-08 | `verificacion` | Alta |
| 4. Radicación | Mostrar el plazo y registrar el radicado | HU-09 a HU-10 | `radicacion` | Alta |
| 5. Estados y alertas | Consultar estados y ver plazos por vencer | HU-11 a HU-12 | `estados`, `alertas` | Alta |
| 6. Cobro | Registrar cobrada, rechazo y pago | HU-13 a HU-15 | `cobro` | Alta |
| 7. Seguimiento y escalamiento | Seguimiento semanal, acuerdos, cobro persuasivo y jurídico | HU-16 a HU-20 | `seguimiento`, `cobro-juridico` | Media |
| 8. Reconocimiento económico | Calcular el valor de la empresa y de la EPS | HU-21 | `reconocimiento` | Media |
| 9. Incapacidades prolongadas | Concepto de rehabilitación y suspensión del pago | HU-22 a HU-24 | `monitoreo` | Media |
| 10. Conciliación contable | Identificar los pagos con Contabilidad | HU-25 a HU-26 | `conciliacion` | Media |
| 11. Reportes | Reporte de ausentismo y de prolongadas | HU-27 a HU-28 | `reportes` | Media |
| 12. Archivo | Archivar lo pagado y eliminar la epicrisis | HU-29 a HU-30 | `archivo` | Media |

**Prioridad:** Alta = indispensable para que el sistema funcione; Media = importante, se hace después de lo principal; Baja = complementaria.

**Lo que no lleva historia:** la transcripción ante la entidad (CU-07) ocurre en el portal o el correo de la entidad y el sistema no participa. El colaborador y las entidades no usan el sistema: solo reciben correos o se comunican con las personas.

## Historias de usuario

Todas las notificaciones del sistema salen por el correo institucional (SMTP). «El sistema muestra la confirmación» significa que la pantalla le confirma al usuario que la operación quedó guardada.

### Módulo 1. Acceso y seguridad

Objetivo: que solo el personal interno use SIGI y que los documentos de salud queden protegidos. Depende de: nada; es la base de todo.

**HU-01 — Iniciar sesión con el correo institucional** · Prioridad: Alta

**Como** usuario interno (personal receptor, líder, auxiliar, Coordinación, Contabilidad y Tesorería, Cartera y Jurídica, SG-SST o Gestión Documental) **quiero** iniciar sesión con mi correo institucional **para** usar SIGI de forma segura.

- Dado que no he iniciado sesión, cuando entro a cualquier página de SIGI, entonces el sistema me pide iniciar sesión.
- Dado que tengo un correo institucional, cuando inicio sesión con Supabase Auth, entonces entro al sistema.
- Dado que una petición llega sin sesión válida, cuando el servidor la recibe, entonces el middleware de autenticación la rechaza.

**HU-02 — Restringir la historia clínica y la epicrisis** · Prioridad: Alta

**Como** auxiliar de Administración de Personal **quiero** ser el único usuario que puede ver la historia clínica y la epicrisis **para** proteger esa información reservada.

- Dado que un documento es historia clínica o epicrisis, cuando un usuario que no es el auxiliar intenta abrirlo, entonces el sistema no se lo muestra.
- Dado que soy el auxiliar, cuando reviso la documentación de una incapacidad, entonces puedo ver la historia clínica y la epicrisis.
- Dado que se guarda cualquier documento escaneado, cuando queda almacenado, entonces está en un bucket privado de Supabase Storage al que solo accede el servidor, nunca el navegador.

No se definen otros permisos por rol. Cómo reconoce el sistema al auxiliar está pendiente de definición (sección final).

### Módulo 2. Registro y recepción

Objetivo: registrar cada incapacidad o licencia y sus documentos, sin importar el canal por el que llegue. Depende de: módulo 1.

**HU-03 — Registrar incapacidad o licencia** · Prioridad: Alta

**Como** personal receptor (o auxiliar, si llega por correo) **quiero** registrar la incapacidad o licencia que entrega el colaborador **para** iniciar su trámite.

- Dado que el colaborador entregó la incapacidad en recepción, oficinas principales o con un líder comercial, cuando el personal receptor la registra con colaborador, tipo, entidad (EPS o ARL), fecha de inicio, días de incapacidad y fecha de recepción, entonces el sistema la guarda, le asigna un identificador y muestra la confirmación.
- Dado que la incapacidad llegó por correo electrónico, cuando el auxiliar la registra con los mismos datos, entonces ocurre lo mismo.
- El tipo es uno de estos: enfermedad general, accidente laboral, enfermedad laboral, accidente de tránsito, licencia de maternidad o licencia de paternidad.
- Al registrarse, la incapacidad queda en su estado inicial «registrada, sin transcribir», con el estado sin valor.

**HU-04 — Registrar la documentación recibida** · Prioridad: Alta

**Como** personal receptor (o auxiliar, si llega por correo) **quiero** registrar los documentos que entregó el colaborador **para** que queden asociados a su incapacidad.

- Dado que la incapacidad ya está registrada, cuando el personal receptor registra los documentos, entonces el sistema guarda cada uno con su tipo y su archivo, los asocia a la incapacidad, avisa al auxiliar por correo que llegaron y muestra la confirmación.
- Dado que los documentos llegaron por correo, cuando el auxiliar los registra, entonces el sistema los guarda, marca el original en físico como pendiente y muestra la confirmación.

**HU-05 — Registrar el reemplazo del colaborador** · Prioridad: Baja

**Como** líder o jefe inmediato **quiero** registrar quién reemplaza al colaborador incapacitado **para** que quede constancia del reemplazo.

- Dado que la incapacidad está registrada, cuando el líder registra el reemplazo, entonces el sistema lo guarda asociado a la incapacidad y muestra la confirmación.
- Una incapacidad tiene como máximo un reemplazo.

### Módulo 3. Verificación documental

Objetivo: confirmar que la documentación esté completa según el tipo de caso y avisar lo que falta. Depende de: módulo 2.

**Documentos obligatorios por tipo de caso** (reglas de la Visión, sección 6):

| Tipo de caso | Documentos obligatorios |
| --- | --- |
| Todos | Soporte (certificado) de la incapacidad en original, con diagnóstico, días e identificación. La copia por correo solo sirve para reportar en 2 días. |
| Enfermedad general | Además, epicrisis o documento soporte si supera 2 días. No se exige si la EPS ya transcribió. |
| Accidente laboral y enfermedad laboral | Además, epicrisis o documento soporte. No se exige si la EPS ya transcribió. |
| Accidente de tránsito | Además, epicrisis o documento soporte y FURIPS. |
| Licencia de maternidad | Certificado, epicrisis o documento con las semanas de gestación, certificado de nacido vivo, registro civil y fotocopia del documento de identidad. |
| Licencia de paternidad | Epicrisis o documento con las semanas de gestación, certificado de nacido vivo, registro civil y fotocopia del documento de identidad de la madre. |

**HU-06 — Verificar la documentación** · Prioridad: Alta

**Como** auxiliar **quiero** verificar que la documentación de una incapacidad esté completa **para** poder radicarla y archivarla en digital.

- Dado que la incapacidad y sus documentos están registrados, cuando solicito verificarla, entonces el sistema obtiene su expediente, lo compara con los documentos obligatorios de su tipo de caso y me muestra el resultado.
- Dado que la documentación está completa, cuando confirmo la verificación, entonces el sistema la registra, archiva la documentación en digital y muestra la confirmación.
- Dado que faltan documentos, cuando veo el resultado, entonces la documentación no se archiva y continúo con HU-07.

**HU-07 — Notificar los documentos faltantes** · Prioridad: Alta

**Como** auxiliar **quiero** registrar los documentos que faltan **para** que el colaborador sepa qué debe entregar y en qué plazo.

- Dado que la verificación mostró faltantes, cuando registro la lista de documentos faltantes, entonces el sistema la guarda, envía al colaborador un correo con los documentos que faltan y el plazo de 3 días hábiles, y muestra la confirmación.
- Dado que el colaborador entrega los documentos, cuando se registran (HU-04), entonces la incapacidad vuelve a quedar lista para verificarse.

**HU-08 — Registrar el segundo llamado** · Prioridad: Media

**Como** auxiliar **quiero** registrar el segundo llamado al colaborador que no entregó los documentos **para** que la Coordinación lo cite.

- Dado que pasaron 3 días hábiles sin que el colaborador entregara los documentos, cuando registro el segundo llamado que le hice, entonces el sistema lo guarda, avisa por correo a la Coordinación de Administración de Personal la citación del colaborador y muestra la confirmación.

### Módulo 4. Radicación

Objetivo: radicar cada incapacidad dentro del plazo de su entidad. La radicación y la transcripción se hacen en el portal o por correo de la entidad; SIGI muestra el plazo y registra el resultado. Depende de: módulo 2.

**HU-09 — Preparar la radicación con su plazo** · Prioridad: Alta

**Como** auxiliar **quiero** ver la entidad y el plazo para radicar una incapacidad **para** no perder el derecho al cobro.

- Dado que la incapacidad está registrada, cuando solicito preparar su radicación, entonces el sistema muestra la entidad, si permite transcripción digital o exige correo, y el plazo calculado con el plazo de transcripción de la entidad.
- Dado que el plazo está por vencer o vencido, cuando se muestra, entonces el sistema lo advierte, pero no impide radicar.

**HU-10 — Registrar la radicación** · Prioridad: Alta

**Como** auxiliar **quiero** registrar el número de radicado y la evidencia **para** dejar constancia de que la incapacidad se presentó a la entidad.

- Dado que radiqué la incapacidad ante la entidad y recibí el número de radicado, cuando registro el radicado y la evidencia, entonces el sistema guarda la radicación, cambia el estado de la incapacidad a «transcrita» y muestra la confirmación.
- Dado que la incapacidad fue rechazada y la transcribí de nuevo, cuando registro la nueva radicación, entonces el sistema la guarda y el estado vuelve a «transcrita». Una incapacidad puede tener varias radicaciones.

### Módulo 5. Estados y alertas

Objetivo: saber en qué va cada incapacidad y qué plazos están por vencer. Depende de: módulos 2 y 4.

**HU-11 — Consultar el estado de las incapacidades** · Prioridad: Alta

**Como** auxiliar **quiero** consultar las incapacidades con filtros **para** ver en qué estado está cada una.

- Dado que hay incapacidades registradas, cuando consulto con filtros, entonces el sistema muestra la lista de las que cumplen los filtros con su estado: transcrita, cobrada, rechazada o pagada.
- La consulta no modifica ningún dato.

**HU-12 — Ver las alertas de plazos** · Prioridad: Alta

**Como** auxiliar **quiero** ver los plazos por vencer y vencidos **para** actuar antes de perder un plazo.

- Dado que hay incapacidades registradas, cuando consulto las alertas, entonces el sistema calcula y muestra, separados, los plazos por vencer y los vencidos de: envío de la incapacidad (2 días), subsanación de documentos (3 días hábiles), transcripción según la entidad, licencia de paternidad (30 días desde el nacimiento) y los hitos de 90, 120, 150 y 180 días.
- Las alertas solo informan: no bloquean ninguna operación.

### Módulo 6. Cobro

Objetivo: llevar cada incapacidad radicada hasta su pago controlando su estado. La solicitud de pago se hace ante la entidad; SIGI registra la respuesta. Depende de: módulo 4.

Estados de la incapacidad: registrada (sin valor) → transcrita → cobrada o rechazada → pagada. Si se rechaza, se transcribe de nuevo y vuelve a transcrita.

**HU-13 — Registrar la incapacidad como cobrada** · Prioridad: Alta

**Como** auxiliar **quiero** registrar que la entidad aprobó la incapacidad **para** controlar su cobro.

- Dado que la incapacidad está transcrita y la entidad respondió con el estado y el tiempo de pago, cuando la registro como cobrada con su tiempo de pago, entonces el sistema cambia el estado a «cobrada», guarda el tiempo de pago y muestra la confirmación.

**HU-14 — Registrar el rechazo de la incapacidad** · Prioridad: Alta

**Como** auxiliar **quiero** registrar el rechazo con su causal **para** solicitar una nueva transcripción.

- Dado que la incapacidad está transcrita y la entidad la rechazó, cuando registro el rechazo con su causal, entonces el sistema cambia el estado a «rechazada», guarda la causal y me la muestra.
- Después pido a la entidad una nueva transcripción y registro la nueva radicación con HU-10.

**HU-15 — Registrar el pago** · Prioridad: Alta

**Como** auxiliar **quiero** registrar el pago de la entidad con su valor **para** dejar la incapacidad como pagada.

- Dado que la incapacidad está cobrada y la entidad pagó, cuando registro el pago con su valor y su fecha, entonces el sistema guarda el pago, cambia el estado a «pagada» y muestra la confirmación.
- Esta misma función se usa cuando el pago se conoce en el seguimiento (HU-16) o después del cobro de Cartera y Jurídica (HU-19). Se programa una sola vez en el grupo `cobro`.
- Una incapacidad puede tener varios pagos.

### Módulo 7. Seguimiento y escalamiento

Objetivo: revisar cada semana lo que no se ha pagado y escalarlo cuando la entidad demora o se niega. Depende de: módulo 6.

**HU-16 — Hacer el seguimiento semanal del cobro** · Prioridad: Media

**Como** auxiliar **quiero** ver las incapacidades cobradas pendientes de pago y registrar su seguimiento **para** cumplir el seguimiento semanal.

- Dado que hay incapacidades cobradas, cuando consulto las pendientes de pago, entonces el sistema muestra la lista.
- Dado que la entidad me informó que ya pagó, cuando registro el pago, entonces se aplica HU-15.
- Dado que el pago sigue pendiente, cuando registro el seguimiento con la evidencia de la gestión, entonces el sistema lo guarda, evalúa si hay demora y muestra la confirmación.

**HU-17 — Avisar el retraso y registrar el acuerdo de pago** · Prioridad: Media

**Como** auxiliar **quiero** que el sistema avise a la Coordinación cuando un pago se demora y registrar el acuerdo que logre **para** recuperar el dinero.

- Dado que el pago supera el tiempo prometido por la entidad, cuando registro el seguimiento, entonces el sistema avisa el retraso por correo a la Coordinación de Administración de Personal.
- Dado que la Coordinación acordó con la entidad la fecha y el valor del pago, cuando registro el acuerdo, entonces el sistema lo guarda y muestra la confirmación.

**HU-18 — Registrar los requerimientos de cobro persuasivo** · Prioridad: Media

**Como** auxiliar **quiero** registrar cada requerimiento de cobro enviado a la entidad **para** dejar evidencia del cobro persuasivo.

- Dado que la incapacidad tiene demora o rechazo y envié un requerimiento con sus fundamentos, cuando lo registro, entonces el sistema lo guarda con sus fundamentos y muestra la confirmación.
- El procedimiento exige mínimo dos requerimientos antes del traslado a Cartera y Jurídica.

**HU-19 — Trasladar la incapacidad a Cartera y Jurídica** · Prioridad: Media

**Como** auxiliar **quiero** trasladar la incapacidad a Cartera y Jurídica **para** que gestionen el cobro.

- Dado que pasaron 180 días sin pago o la entidad tiene deterioro crediticio, cuando traslado la incapacidad indicando el motivo, entonces el sistema guarda el traslado, avisa por correo a Cartera y Jurídica y muestra la confirmación.
- Si la entidad paga después del cobro de Cartera y Jurídica, ellos me informan y registro el pago con HU-15.

**HU-20 — Registrar la decisión de Cartera y Jurídica** · Prioridad: Baja

**Como** Cartera y Jurídica **quiero** registrar la decisión de recuperar o dar de baja la acreencia **para** cerrar el cobro jurídico.

- Dado que la entidad se negó a pagar y se tramitó el derecho de petición (y la tutela si no respondió), cuando registro la decisión, entonces el sistema la guarda y muestra la confirmación.
- El derecho de petición y la tutela se tramitan fuera del sistema; SIGI no toma la decisión, solo la registra.

### Módulo 8. Reconocimiento económico

Objetivo: calcular qué valor asume la empresa y cuál la EPS. Depende de: módulo 2 (necesita los días de incapacidad).

**HU-21 — Calcular el reconocimiento económico** · Prioridad: Media

**Como** auxiliar **quiero** ingresar el IBC de la incapacidad y obtener el cálculo **para** saber cuánto paga la empresa y cuánto la EPS.

- Dado que la incapacidad tiene sus días registrados, cuando ingreso el IBC y solicito el cálculo, entonces el sistema aplica los tramos del procedimiento:
  - Días 1 y 2: 100 % del IBC a cargo de la empresa.
  - Días 3 a 90: 67 % del IBC a cargo de la EPS.
  - Días 91 a 180: 50 % del IBC a cargo de la EPS.
  - Desde el día 181: el sistema marca el trámite de pensión.
- Entonces el sistema guarda el IBC, el valor a cargo de la empresa y el valor a cargo de la EPS, y me muestra el resultado.
- El IBC lo ingresa el auxiliar al calcular, no se pide al registrar la incapacidad.

### Módulo 9. Incapacidades prolongadas

Objetivo: controlar las incapacidades de más de 90 días, su concepto de rehabilitación y la suspensión del pago. Depende de: módulo 2.

**HU-22 — Consultar las prolongadas y registrar el concepto de rehabilitación** · Prioridad: Media

**Como** auxiliar **quiero** ver las incapacidades prolongadas y registrar su concepto de rehabilitación **para** cumplir los controles del día 120.

- Dado que hay incapacidades de más de 90 días, cuando consulto el reporte de prolongadas, entonces el sistema me lo muestra.
- Dado que la entidad emitió el concepto de rehabilitación que le pedí en el día 120, cuando lo registro, entonces el sistema lo guarda, lo comunica por correo al colaborador y muestra la confirmación.
- El envío del concepto a la AFP lo hace el auxiliar fuera del sistema.

**HU-23 — Registrar la falta del concepto** · Prioridad: Media

**Como** auxiliar **quiero** registrar que la entidad no ha emitido el concepto **para** dejar constancia y avisar al colaborador.

- Dado que la entidad no emitió el concepto y ya se lo notifiqué, cuando registro la falta del concepto, entonces el sistema la guarda, avisa por correo al colaborador y muestra la confirmación.

**HU-24 — Registrar la suspensión del pago** · Prioridad: Media

**Como** auxiliar **quiero** registrar la suspensión del pago de una incapacidad que supera 180 días **para** que el colaborador quede notificado.

- Dado que la incapacidad supera 180 días, cuando registro la suspensión del pago, entonces el sistema la guarda, notifica por correo la suspensión al colaborador y muestra la confirmación.
- El reintegro de pagos de más de 180 días se gestiona fuera del sistema.

### Módulo 10. Conciliación contable

Objetivo: identificar a qué colaborador e incapacidad corresponde cada pago que consignan las entidades. Depende de: módulo 6.

**HU-25 — Registrar los pagos consignados** · Prioridad: Media

**Como** Contabilidad y Tesorería **quiero** registrar los pagos que consignaron las entidades en el mes **para** que el auxiliar los identifique.

- Dado que tengo la lista de pagos consignados del mes, cuando la registro con entidad, colaborador, días pagados y valor, entonces el sistema la guarda, avisa por correo al auxiliar que hay pagos por identificar y me muestra la confirmación.

**HU-26 — Identificar los pagos y conciliar** · Prioridad: Media

**Como** auxiliar **quiero** comparar los pagos consignados con el detalle de pagos de cada entidad **para** conciliarlos con Contabilidad.

- Dado que hay pagos consignados, cuando ingreso el detalle de pagos de una entidad, entonces el sistema obtiene los pagos consignados de esa entidad y los compara con el detalle.
- Dado que todos los pagos quedan identificados, entonces el sistema guarda la conciliación de la entidad, envía por correo el detalle conciliado a Contabilidad y Tesorería y muestra la confirmación.
- Dado que quedan saldos sin identificar, entonces el sistema guarda los saldos pendientes, los notifica por correo a Contabilidad y Tesorería y me los muestra.

### Módulo 11. Reportes

Objetivo: generar los dos reportes que exige el procedimiento. Depende de: módulo 2.

**HU-27 — Generar el reporte de ausentismo** · Prioridad: Media

**Como** auxiliar **quiero** generar el reporte de ausentismo del periodo **para** entregarlo al SG-SST en los primeros 3 días de cada mes.

- Dado que hay incapacidades del periodo, cuando solicito el reporte de ausentismo, entonces el sistema consolida los datos del periodo, guarda el reporte, lo envía por correo al SG-SST y me lo muestra.

**HU-28 — Generar el reporte mensual de incapacidades prolongadas** · Prioridad: Media

**Como** auxiliar **quiero** generar el reporte mensual de incapacidades prolongadas **para** controlar sus hitos.

- Dado que hay incapacidades prolongadas en el periodo, cuando solicito el reporte, entonces el sistema consolida los datos, clasifica las incapacidades por hito (90, 120, 150 y 180 días), guarda el reporte y me lo muestra.

### Módulo 12. Archivo

Objetivo: cerrar el ciclo de las incapacidades pagadas y eliminar la epicrisis. Depende de: módulos 6 y 10.

**HU-29 — Archivar una incapacidad pagada** · Prioridad: Media

**Como** auxiliar **quiero** enviar a Gestión Documental las incapacidades pagadas **para** cerrar su trámite.

- Dado que hay incapacidades pagadas, cuando las consulto, entonces el sistema me muestra la lista.
- Dado que el pago de la incapacidad está identificado y conciliado, cuando solicito archivarla, entonces el sistema elimina la epicrisis si la tiene, envía la incapacidad por correo a Gestión Documental y me confirma que el archivo está preparado.
- Dado que el pago no está identificado, cuando solicito archivarla, entonces el sistema me muestra una advertencia y no la envía.

**HU-30 — Registrar el envío al archivo** · Prioridad: Media

**Como** auxiliar **quiero** registrar que entregué los documentos físicos a Gestión Documental **para** dejar la incapacidad cerrada.

- Dado que el archivo está preparado y entregué los documentos físicos, cuando registro el envío, entonces el sistema lo guarda, la incapacidad queda enviada a Gestión Documental (estado final del ciclo) y muestra la confirmación.

## Plan de desarrollo de 15 días

Se avanza módulo por módulo, en el orden del 1 al 12: cada módulo se programa, se prueba con los criterios de aceptación de sus historias y se deja terminado antes de empezar el siguiente. El orden sigue las dependencias, así que cada módulo solo usa lo que ya está terminado.

| Día | Módulo | Historias | Pendientes a resolver antes |
| --- | --- | --- | --- |
| 1 | Base: proyecto Express con EJS, estructura de carpetas, conexión a Supabase, las 13 tablas, layout y correo SMTP | — | — |
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
| 15 | Prueba integral: recorrido completo de una incapacidad, pruebas de aceptación sin errores críticos (criterio de éxito del Acta) y correcciones | Todas | — |

La última columna indica qué punto de la sección «Pendientes de definición» debe estar decidido antes de empezar ese módulo.

## Pendientes de definición

Las entregas no definen estos datos y no se inventaron. Hay que decidirlos antes de programar la historia afectada.

| N.º | Qué falta | Historias afectadas |
| --- | --- | --- |
| 1 | **Correo del colaborador.** La clase Colaborador solo tiene «nombre», pero el sistema le envía cuatro correos (faltantes, concepto, falta de concepto y suspensión). No está definido de dónde sale su dirección. | HU-07, HU-22, HU-23, HU-24 |
| 2 | **Cómo reconoce el sistema al auxiliar.** Supabase Auth solo identifica al usuario; los roles no tienen atributos en el diagrama de clases. | HU-02 |
| 3 | **Catálogos de entidades y colaboradores.** Ningún caso de uso los registra. El procedimiento (§5.2.1) trae los plazos de Salud Total, Nueva EPS, SOS, Sanitas, SURA EPS, Asmet Salud y ARL SURA, pero no se definió cómo se cargan. | HU-03, HU-09, HU-12 |
| 4 | **Fechas de las alertas.** Desde qué fecha corre cada plazo (no se guarda la fecha del aviso de faltantes ni la del nacimiento), cuántos días antes es «por vencer» y qué festivos cuentan para los días hábiles. | HU-08, HU-12 |
| 5 | **Fórmula del IBC.** El procedimiento da los porcentajes, pero no cómo pasar el IBC a valor por día ni si aplica igual a la ARL y a las licencias. | HU-21 |
| 6 | **Filtros de la consulta de estados.** El diagrama de secuencia dice «filtros» sin definirlos. | HU-11 |
| 7 | **Contenido del reporte de ausentismo.** No se definen sus columnas. | HU-27 |
| 8 | **Pago «identificado y conciliado».** La conciliación se guarda por entidad, no por incapacidad; falta definir cómo sabe el sistema que el pago de una incapacidad ya se concilió. | HU-29 |

Nombre del sistema e integrantes: se toman los de la Segunda Entrega (SIGI – Sistema Integral de Gestión de Incapacidades; Juan Jose Rivera y Samuel Zuleta).
