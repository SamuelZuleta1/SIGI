# 00 · Inventario de la documentación — SIGI

> Fase 0 de la auditoría. Fecha: 2026-11-16.
> Este archivo solo **describe** lo que dicen las fuentes; no corrige nada. Lo ambiguo o ilegible va marcado con ❓.

## Fuentes revisadas

| ID | Fuente | Ruta | Cómo se leyó |
| --- | --- | --- | --- |
| F1 | Documentación de Análisis y Diseño, Segunda Entrega (79 págs.) | `docs/entregas/SIGI_Documentacion_Analisis_y_Diseno_Segunda_Entrega.pdf` | Texto extraído de cada página y cada página renderizada como imagen. Diagramas de casos de uso (p. 10) y DS-04 (p. 32) revisados además a 260–300 ppp. |
| F2 | Historias de Usuario – SIGI (30 HU) | `docs/contexto/Historias_de_Usuario_SIGI.md` | Lectura completa. |
| F3 | Contexto del proyecto | `docs/contexto/CONTEXTO_PROYECTO.md` | Lectura completa (resumen de F1 + F2; incluye 8 «pendientes de definición»). |
| F4 | Fuentes editables de los diagramas | `docs/modelado/**/*.drawio` y `*.png` | Etiquetas, emisor y receptor de cada mensaje extraídos del XML de los `.drawio`. |
| F5 | Documento de Visión y Alcance | `docs/modelado/01_Documentos/Documento_Vision_Alcance_SIGI.docx` | Solo §5.3 (Entorno de operación) y §6 (reglas de documentación). |

❓ **Legibilidad de F1.** En el PDF, los textos de los diagramas de secuencia, comunicación, clases y estados son muy pequeños para leerlos a 150 ppp. Por eso el detalle de cada mensaje se tomó de los `.drawio` (F4) y se comparó con el PDF en DS-04 (p. 32), donde coinciden. Los diagramas del PDF están hechos con otra herramienta (aspecto de Enterprise Architect), no son la exportación de los `.drawio`. No se compararon mensaje por mensaje los 41 diagramas del PDF contra los `.drawio`. Ver hallazgo H-21.

No hay documento de requisitos funcionales aparte: los requisitos son las características CAR-01 a CAR-11 (F1 §2.3).

---

## 1. Actores (F1 §2.5, diagrama de casos de uso p. 10, F5 §5.3)

| Actor | Tipo | ¿Usa el sistema? | Casos de uso asociados en el diagrama (F1 p. 10) |
| --- | --- | --- | --- |
| Colaborador | Externo | No. Recibe correos | CU-01, CU-02, CU-05, CU-14 |
| Personal receptor | Usuario | Sí | CU-01, CU-02 |
| Líder / Jefe inmediato | Usuario | Sí | CU-03 |
| Auxiliar de Administración de Personal | Usuario principal | Sí | CU-01, CU-02, CU-04 a CU-17 (todos menos CU-03) |
| Coordinación de Administración de Personal | Usuario | F5 §5.3 lo cuenta como usuario, pero en los DS solo recibe correos | CU-05, CU-11 |
| Contabilidad y Tesorería | Usuario | Sí (DS-11) | CU-15 |
| Cartera y Jurídica | Usuario | Sí (DS-08) | CU-12 |
| SG-SST | Usuario | F5 §5.3 lo cuenta como usuario, pero en los DS solo recibe correos | CU-16 |
| Gestión Documental | Usuario | F5 §5.3 lo cuenta como usuario, pero en los DS solo recibe correos | CU-17 |
| EPS / ARL / AFP | Entidad externa | No. Se comunica con las personas | CU-06, CU-07, CU-10, CU-11, CU-12, CU-14 |

❓ En F1 p. 10 algunas líneas de asociación se cruzan y no se puede confirmar a simple vista a qué caso de uso llegan (por ejemplo, Colaborador → «Monitorear incapacidades prolongadas»). La tabla de arriba combina la imagen con los actores que declara cada CU documentado.

## 2. Casos de uso (F1 §3.2)

Relaciones: 3 «extend» (CU-05 → CU-04, CU-07 → CU-06, CU-12 → CU-11). No hay «include».

| CU | Nombre | Actores | Objetivo | Precondiciones | Flujo principal (resumen) | Flujos alternos | Postcondiciones | CAR | DS / CO |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CU-01 | Registrar incapacidad o licencia | Colaborador, Personal receptor, Auxiliar | Registrar la incapacidad con sus 6 datos mínimos | El colaborador la presentó por un canal | Receptor registra colaborador, tipo, entidad, fechaInicio, días, fechaRecepcion → el sistema guarda y da el id → confirma | A1: llega por correo, registra el auxiliar | Guardada con id y datos mínimos; id disponible para CU-02 | CAR-01 | DS-01 / CO-01 |
| CU-02 | Registrar documentación recibida | Colaborador, Personal receptor, Auxiliar | Registrar los documentos entregados | CU-01 hecho | Receptor registra documentos → el sistema guarda y asocia → notifica al auxiliar → confirma | A1: por correo, registra el auxiliar y el original queda pendiente | Documentos asociados; aviso al auxiliar u original pendiente | CAR-01, CAR-10 | DS-01 / CO-01 |
| CU-03 | Gestionar reemplazo del colaborador | Líder | Dejar registrado el reemplazo | CU-01 hecho | Líder registra el reemplazo → guarda → confirma | Ninguno | Reemplazo asociado | CAR-01 | DS-02 / CO-02 |
| CU-04 | Verificar documentación | Auxiliar | Confirmar que la documentación esté completa y archivarla en digital | CU-01 y CU-02 hechos | Solicita verificar → obtiene expediente y compara con los requisitos del tipo → muestra resultado → confirma → registra y archiva en digital | A1: faltan documentos → CU-05 | Verificada y archivada, o se sigue en CU-05 | CAR-02, CAR-10 | DS-03 / CO-03 |
| CU-05 | Notificar documentos faltantes | Auxiliar, Colaborador, Coordinación | Avisar faltantes con plazo de 3 días hábiles; segundo llamado | CU-04 mostró faltantes | Registra faltantes → guarda → correo al colaborador (3 días hábiles) → confirma | A1: no entrega en 3 días hábiles → el auxiliar hace el segundo llamado (fuera) y lo registra → correo a la Coordinación | Faltantes guardados; segundo llamado y aviso a la Coordinación si aplica | CAR-02 | DS-03 / CO-03 |
| CU-06 | Radicar incapacidad ante EPS / ARL | Auxiliar, EPS/ARL | Presentar la incapacidad y registrar el radicado y la evidencia | CU-01 hecho | Prepara radicación → el sistema calcula y muestra el plazo (advierte, no bloquea) → radica fuera → registra radicado y evidencia → guarda → confirma | A1: requiere transcripción → CU-07 | Radicado y evidencia guardados (**no menciona cambio de estado**) | CAR-04 | DS-04 / CO-04 |
| CU-07 | Transcribir incapacidad | Auxiliar, EPS/ARL | Transcribir en el portal o por correo | Requiere transcripción; CU-06 pasos 1–2 | Transcribe en el portal → la entidad confirma (**el sistema no participa**) | A1: por correo (SOS, Sanitas, Famisanar) | La entidad confirmó | CAR-04 | DS-04 / CO-04 |
| CU-08 | Consultar estado de la incapacidad | Auxiliar | Ver transcrita, cobrada, rechazada o pagada | Ninguna | Consulta con filtros → lista con estado | Ninguno | No modifica datos | CAR-04 | DS-05 / CO-05 |
| CU-09 | Generar alertas de plazos | Auxiliar | Ver plazos por vencer y vencidos | Ninguna | Consulta alertas → el sistema calcula vencimientos → muestra | Ninguno | Las alertas informan y no bloquean | CAR-03 | DS-14 / CO-14 |
| CU-10 | Gestionar cobro de la incapacidad | Auxiliar, EPS/ARL | Llevar la incapacidad hasta su pago controlando el estado | CU-01 y CU-06 hechos | Solicita el pago fuera → la entidad responde → registra cobrada con tiempoPago → estado cobrada | A1: la entidad paga → registra pago → pagada. A2: rechaza → registra causal → rechazada → pide nueva transcripción | cobrada / pagada / rechazada | CAR-04, CAR-05 | DS-06 / CO-06 |
| CU-11 | Realizar seguimiento al cobro | Auxiliar, EPS/ARL, Coordinación | Seguimiento semanal de las cobradas | Hay cobradas pendientes de pago | Consulta pendientes → por cada una consulta a la entidad → si ya pagó, registra el pago → pagada | A1: sigue pendiente → registra seguimiento con evidencia → evalúa demora. A2: supera el tiempo prometido → correo a la Coordinación → negociación fuera → registra acuerdo | Pago, seguimiento o acuerdo guardados | CAR-05 | DS-07 / CO-07 |
| CU-12 | Gestionar cobro persuasivo y jurídico | Auxiliar, Cartera y Jurídica, EPS/ARL | Recuperar lo no pagado | **Demora de pago o rechazo** (CU-10, CU-11) | ≥2 requerimientos registrados → traslado a Cartera (180 días o deterioro) con correo → Cartera cobra fuera → informa el pago → el auxiliar registra el pago → pagada | A1: se niega → derecho de petición → Cartera registra la decisión (recuperar / dar de baja). A2: no responde → tutela → A1.3. A3: no hay condición de traslado → termina | Requerimientos, traslado, pago o decisión guardados | CAR-05 | DS-08 / CO-08 |
| CU-13 | Calcular reconocimiento económico (IBC) | Auxiliar | Valor de la empresa y de la EPS | CU-01 con días | Ingresa el IBC → obtiene los días → valor empresa (100 %) → guarda ibc, valorEmpresa, valorEPS → muestra | A1: días 3–90 → 67 %. A2: 91–180 → 50 %. A3: >180 → marca trámite de pensión | Cálculo guardado; trámite de pensión marcado si aplica | CAR-06 | DS-09 / CO-09 |
| CU-14 | Monitorear incapacidades prolongadas | Auxiliar, EPS/ARL/AFP, Colaborador | Controlar el concepto de rehabilitación y la suspensión | Hay prolongadas | Consulta el reporte → día 120: pide el concepto fuera → registra el concepto → correo al colaborador → lo envía a la AFP fuera | A1: sin concepto → registra la falta → correo al colaborador. A2: >180 días → registra la suspensión → correo al colaborador | Concepto, falta o suspensión guardados | CAR-07 | DS-10 / CO-10 |
| CU-15 | Conciliar pagos con contabilidad | Contabilidad y Tesorería, Auxiliar | Identificar a quién corresponde cada pago | Contabilidad tiene la lista del mes | Contabilidad registra los pagos consignados → correo al auxiliar → por entidad, el auxiliar identifica con el detalle → el sistema compara → guarda la conciliación → envía el detalle conciliado | A1: quedan saldos → guarda los saldos → correo a Contabilidad | Conciliación o saldos guardados | CAR-08 | DS-11 / CO-11 |
| CU-16 | Generar reportes de ausentismo e incapacidades prolongadas | Auxiliar, SG-SST | Reporte de ausentismo al SG-SST y reporte mensual de prolongadas | Ninguna | Ausentismo: consolida → guarda → envía al SG-SST → muestra | A1: prolongadas → consolida → clasifica por hito → guarda → muestra | Reporte guardado (y enviado si es de ausentismo) | CAR-09 | DS-12 / CO-12 |
| CU-17 | Archivar incapacidad pagada | Auxiliar, Gestión Documental | Enviar lo pagado a Gestión Documental y eliminar la epicrisis | Hay pagadas | Consulta pagadas → solicita archivar → verifica el estado del pago → envía a Gestión Documental → confirma → entrega física fuera → registra el envío | A1: tiene historia clínica o epicrisis → elimina la epicrisis. A2: pago no identificado → advertencia, no envía | Enviada y registrada, o advertencia | CAR-10, CAR-11 | DS-13 / CO-13 |

## 3. Diagramas de secuencia y de comunicación (F1 §4 y §5; F4)

Las líneas de vida de todos los DS son: actores + **Interfaz de incapacidades** (Vista) + **Control de incapacidades** (Controlador) + **Base de datos** (Persistencia). Cada CO-xx tiene los mismos mensajes que su DS-xx; se comprobó por nombre de mensaje en los 14 pares y no hay diferencias.

| DS / CO | CU | Participantes | Mensajes al sistema (Vista → Control → Persistencia) | Notificaciones (Control → actor) | Fragmentos |
| --- | --- | --- | --- | --- | --- |
| DS-01 | CU-01, CU-02 | Colaborador, Receptor, Auxiliar, Vista, Control, BD | registrarIncapacidad(colaborador, tipo, entidad, fechaInicio, dias, fechaRecepcion) → guardarIncapacidad → idIncapacidad; registrarDocumentos(idIncapacidad, documentos) → guardarDocumentos(documentos); marcarOriginalPendiente(idIncapacidad) | notificarRecepcion(idIncapacidad) → Auxiliar | alt: recepción / correo |
| DS-02 | CU-03 | Líder, Vista, Control, BD | registrarReemplazo(idIncapacidad, reemplazo) → guardarReemplazo | — | — |
| DS-03 | CU-04, CU-05 | Colaborador, Auxiliar, Vista, Control, BD, Coordinación | verificarDocumentacion → obtenerExpediente → compararConRequisitos(); confirmarVerificacion → registrarVerificacion → archivarDigital; notificarFaltantes(listaFaltantes) → registrarFaltantes → guardarFaltantes; registrarSegundoLlamado → guardarSegundoLlamado | notificarFaltantes(plazo3DiasHabiles) → Colaborador; notificarCitacion → Coordinación | alt completa / faltan; opt segundo llamado |
| DS-04 | CU-06, CU-07 | EPS/ARL, Auxiliar, Vista, Control, BD | prepararRadicacion → obtenerDatosRadicacion → calcularPlazoRadicacion() → datosRadicacion(entidad, plazo, vencido); registrarRadicacion(radicado, evidencia) → guardarRadicacion(radicado, evidencia) | — | opt transcripción { alt portal / correo } (fuera del sistema) |
| DS-05 | CU-08 | Auxiliar, Vista, Control, BD | consultarEstados(filtros) → obtenerEstados → consultarIncapacidades(filtros) | — | — |
| DS-06 | CU-10 | EPS/ARL, Auxiliar, Vista, Control, BD | registrarCobrada(id, tiempoPago) → actualizarEstado(id, cobrada) → guardarEstado(cobrada, tiempoPago); registrarPago(id, valor) → actualizarEstado(id, pagada) → guardarPago(valor, fechaPago); registrarRechazo(id, causal) → actualizarEstado(id, rechazada) → guardarRechazo(causal) | — | alt aprueba {opt paga} / rechaza |
| DS-07 | CU-11 | Coordinación, EPS/ARL, Auxiliar, Vista, Control, BD | consultarPendientesDePago → obtenerPendientes → consultarCobradas; registrarPago (igual que DS-06); registrarSeguimiento(evidencia) → guardarSeguimiento → evaluarDemora(); registrarAcuerdo(acuerdo) → guardarAcuerdo | notificarRetraso → Coordinación | loop por pendiente { alt pagó / pendiente { opt demora } } |
| DS-08 | CU-12 | Auxiliar, Vista, Control, BD, EPS/ARL, Cartera | registrarRequerimiento(fundamentos) → guardarRequerimiento; trasladarACartera(id, motivo) → guardarTraslado(motivo); registrarPago (igual que DS-06); registrarDecision(decision) → guardarDecision (lo hace Cartera) | notificarTraslado → Cartera y Jurídica | loop ≥2 requerimientos; opt 180 días o deterioro { alt paga / se niega { alt responde / tutela } } |
| DS-09 | CU-13 | Auxiliar, Vista, Control, BD | calcularReconocimiento(id, ibc) → obtenerDatosCalculo → calcularValorEmpresa(100 %) [→ calcularValorEPS(67 %)] [→ calcularValorEPS(50 %)] [→ marcarTramitePension()] → guardarCalculo(ibc, valorEmpresa, valorEPS) | — | 3 opt anidados por tramo |
| DS-10 | CU-14 | EPS/ARL/AFP, Auxiliar, Vista, Control, BD, Colaborador | consultarReporteProlongadas → consultarReporte(prolongadas); registrarConcepto(concepto) → guardarConcepto; registrarFaltaConcepto() → guardarFaltaConcepto(); registrarSuspensionPago(id) → guardarSuspension | comunicarConcepto, avisarFaltaConcepto, notificarSuspensionPago → Colaborador | loop día 120 { alt concepto / sin concepto }; opt >180 |
| DS-11 | CU-15 | Auxiliar, Vista, Control, BD, Contabilidad | registrarPagosConsignados(listaPagos) → guardarPagosConsignados; identificarPagos(entidad, detallePagos) → obtenerPagosConsignados(entidad) → compararPagos() → guardarConciliacion(detalle) / guardarSaldosPendientes(saldos) | notificarPagosPorIdentificar → Auxiliar; enviarDetalleConciliado, notificarSaldosPendientes → Contabilidad | loop por entidad { alt identificados / saldos } |
| DS-12 | CU-16 | SG-SST, Auxiliar, Vista, Control, BD | generarReporte(tipo, periodo) → consultarDatosReporte → consolidarDatos() → [clasificarPorHito()] → guardarReporte(tipo) | enviarReporteAusentismo → SG-SST | alt ausentismo / prolongadas |
| DS-13 | CU-17 | Auxiliar, Vista, Control, BD, Gestión Documental | consultarPagadas → obtenerPagadas → consultarPagadas; archivarIncapacidad(id) → obtenerEstadoPago → [eliminarEpicrisis(id)]; registrarEnvioArchivo(id) → guardarEnvio(id) | enviarParaArchivo → Gestión Documental | loop { alt identificado { opt epicrisis } / no identificado } |
| DS-14 | CU-09 | Auxiliar, Vista, Control, BD | consultarAlertas → obtenerAlertas → consultarPlazos → calcularVencimientos() → listaAlertas(porVencer, vencidas) | — | — |

Mensajes que ocurren fuera del sistema (entre personas): entregarDocumentos, enviarPorCorreo, realizarSegundoLlamado, transcribirEnPortal, radicarIncapacidad, solicitarPagoPrestacion, notificarPago, solicitarNuevaTranscripcion, consultarEstadoPago, negociarPago, comunicarAcuerdo, enviarRequerimiento, cobrarAcreencia, informarPago, radicarDerechoDePeticion, radicarTutela, solicitarConcepto, enviarConceptoAFP, notificarFaltaConcepto, entregarDocumentosFisicos.

## 4. Clases y entidades (F1 §6; CL-01)

- **Vista** «Interfaz de incapacidades»: 31 operaciones. **Controlador** «Control de incapacidades»: 42. **Persistencia** «Base de datos»: 38. **13 notificaciones** del Control a los actores (F1 §6.4.4).
- **Modelo** (13 clases, sin métodos ni tipos de dato):

| Clase | Atributos | Relación |
| --- | --- | --- |
| Colaborador | nombre | 1 → 0..* Incapacidad |
| Entidad | nombre, tipo (EPS/ARL/AFP), plazoTranscripcion, permiteTranscripcionDigital | 1 ← 0..* Incapacidad; 1 → 0..* PagoConsignado; 1 → 0..* Conciliacion |
| Incapacidad | idIncapacidad, tipo, fechaInicio, diasIncapacidad, fechaRecepcion, estado, originalPendiente, documentacionCompleta, archivadoDigital, faltantes[0..*], segundoLlamado, tiempoPago, causalRechazo, motivoTraslado, decision, concepto, faltaConcepto, pagoSuspendido, ibc, valorEmpresa, valorEPS, enviadaAGestionDocumental | clase central |
| Documento | tipo, archivo | composición 1..* |
| Reemplazo | reemplazo | composición 0..1 |
| Radicacion | radicado, evidencia | composición 0..* |
| Requerimiento | fundamentos | composición 0..* |
| Seguimiento | evidencia | composición 0..* |
| AcuerdoPago | fecha, valor | composición 0..* |
| Pago | valor, fechaPago | composición 0..* («pueden ser pagos parciales», F1 §6.5) |
| PagoConsignado | entidad, colaborador, diasPagados, valor | Entidad 1 → 0..* |
| Conciliacion | detalle, saldosPendientes | Entidad 1 → 0..* |
| Reporte | tipo (ausentismo / prolongadas), periodo | sin relaciones |

- **Estados** (F1 §8): EST-01 ciclo de cobro: Registrada (sin valor) → Transcrita (por `registrarRadicacion`) → Cobrada / Rechazada; Rechazada → Transcrita; Cobrada → Pagada → final (por `registrarEnvioArchivo`). EST-02 documentación: Registrada sin documentos → Documentos registrados → En verificación → Verificada y archivada en digital | Documentación incompleta {Con faltantes → *after(3 días hábiles)* → Con segundo llamado} → Documentos registrados.
- **Actividades** (F1 §7): AD-01 (proceso general) a AD-07. AD-01 no incluye CU-08, CU-09, CU-13, CU-14 ni CU-16.
- **Componentes y despliegue** (F1 §9–10): navegador → servidor de aplicación Node.js + Express (HTTPS) → Supabase (Auth, PostgreSQL, Storage con bucket privado) y correo institucional (SMTP). El servidor es un nodo genérico, con ubicación y proveedor sin definir.

## 5. Historias de usuario (F2)

| HU | Rol | Acción | Beneficio | Criterios de aceptación (resumen) | Prior. |
| --- | --- | --- | --- | --- | --- |
| HU-01 | Usuario interno (8 roles) | Iniciar sesión con el correo institucional | Usar SIGI de forma segura | Sin sesión pide login; login con Supabase Auth; el middleware rechaza peticiones sin sesión | Alta |
| HU-02 | Auxiliar | Ser el único que ve la historia clínica y la epicrisis | Proteger la información reservada | Otro usuario no las ve; el auxiliar sí; todo en un bucket privado, nunca accesible desde el navegador | Alta |
| HU-03 | Receptor / Auxiliar | Registrar incapacidad o licencia | Iniciar el trámite | 6 datos; id y confirmación; por correo lo registra el auxiliar; 6 tipos; estado inicial sin valor | Alta |
| HU-04 | Receptor / Auxiliar | Registrar la documentación | Asociarla a la incapacidad | Guarda tipo y archivo; correo al auxiliar; por correo, original pendiente | Alta |
| HU-05 | Líder | Registrar el reemplazo | Constancia | Guarda y confirma; máximo uno | Baja |
| HU-06 | Auxiliar | Verificar la documentación | Radicar y archivar en digital | Compara con los obligatorios; si está completa, registra y archiva; si faltan, HU-07 | Alta |
| HU-07 | Auxiliar | Registrar faltantes | Que el colaborador sepa qué y cuándo | Guarda, correo con 3 días hábiles, confirma; al llegar los documentos vuelve a estar lista para verificar | Alta |
| HU-08 | Auxiliar | Registrar el segundo llamado | Que la Coordinación cite al colaborador | Pasados 3 días hábiles, guarda y avisa a la Coordinación | Media |
| HU-09 | Auxiliar | Ver la entidad y el plazo de radicación | No perder el derecho al cobro | Muestra la entidad, si es digital o por correo, y el plazo; advierte por vencer o vencido sin bloquear | Alta |
| HU-10 | Auxiliar | Registrar la radicación | Constancia | Guarda radicado y evidencia; estado → transcrita; varias radicaciones | Alta |
| HU-11 | Auxiliar | Consultar estados con filtros | Ver el estado | Lista con estado; solo lectura | Alta |
| HU-12 | Auxiliar | Ver alertas de plazos | Actuar a tiempo | Por vencer y vencidos de 8 tipos de plazo; no bloquean | Alta |
| HU-13 | Auxiliar | Registrar cobrada | Controlar el cobro | Desde transcrita → cobrada + tiempoPago | Alta |
| HU-14 | Auxiliar | Registrar el rechazo | Pedir nueva transcripción | Desde transcrita → rechazada + causal; luego HU-10 | Alta |
| HU-15 | Auxiliar | Registrar el pago | Dejarla pagada | Valor y fecha → pagada; reutilizable; varios pagos | Alta |
| HU-16 | Auxiliar | Seguimiento semanal | Cumplir el seguimiento | Lista de pendientes; pago (HU-15) o seguimiento con evidencia + evaluar demora | Media |
| HU-17 | Auxiliar | Avisar retraso y registrar acuerdo | Recuperar el dinero | Correo a la Coordinación; acuerdo con fecha y valor | Media |
| HU-18 | Auxiliar | Registrar requerimientos | Evidencia del cobro persuasivo | Con demora o rechazo, guarda fundamentos; mínimo dos antes del traslado | Media |
| HU-19 | Auxiliar | Trasladar a Cartera y Jurídica | Que gestionen el cobro | 180 días o deterioro; motivo; correo; pago posterior con HU-15 | Media |
| HU-20 | Cartera y Jurídica | Registrar la decisión | Cerrar el cobro jurídico | Recuperar o dar de baja; se tramita fuera | Baja |
| HU-21 | Auxiliar | Calcular el reconocimiento | Saber cuánto paga cada uno | Tramos 100/67/50 % y trámite de pensión; guarda ibc, valorEmpresa, valorEPS | Media |
| HU-22 | Auxiliar | Ver prolongadas y registrar el concepto | Control del día 120 | Reporte; concepto + correo al colaborador; el envío a la AFP es externo | Media |
| HU-23 | Auxiliar | Registrar la falta del concepto | Constancia y aviso | Guarda + correo al colaborador | Media |
| HU-24 | Auxiliar | Registrar la suspensión del pago | Notificar al colaborador | >180 días; guarda + correo | Media |
| HU-25 | Contabilidad y Tesorería | Registrar pagos consignados | Que el auxiliar los identifique | entidad, colaborador, díasPagados, valor; correo al auxiliar | Media |
| HU-26 | Auxiliar | Identificar pagos y conciliar | Conciliar con Contabilidad | Compara por entidad; conciliación + correo o saldos + correo | Media |
| HU-27 | Auxiliar | Reporte de ausentismo | Entregarlo al SG-SST | Consolida, guarda, envía, muestra | Media |
| HU-28 | Auxiliar | Reporte mensual de prolongadas | Controlar los hitos | Clasifica por hito, guarda, muestra | Media |
| HU-29 | Auxiliar | Archivar una pagada | Cerrar el trámite | Lista; si identificada y conciliada, elimina la epicrisis y envía por correo; si no, advierte | Media |
| HU-30 | Auxiliar | Registrar el envío al archivo | Cerrar la incapacidad | Guarda; estado final del ciclo | Media |

F2 declara que **CU-07 no lleva historia** porque ocurre fuera del sistema.

## 6. Reglas de negocio y requisitos no funcionales

**Reglas de negocio** (F1 §2.4, §2.7, §2.8 y los CU; detalle en F3 §7):
- RN-01 Contenido mínimo del registro: colaborador, tipo, entidad, fechaInicio, días, fechaRecepcion.
- RN-02 Seis tipos de caso.
- RN-03 Documentos obligatorios por tipo de caso (F1 §2.8; D-01, D-02, D-03).
- RN-04 Por correo, el original físico queda pendiente y es obligatorio (D-01).
- RN-05 Plazos: envío 2 días; subsanación 3 días hábiles; transcripción según la entidad; paternidad 30 días desde el nacimiento; hitos 90/120/150/180.
- RN-06 Las alertas informan y no bloquean; radicar con el plazo vencido solo se advierte (D-10).
- RN-07 Ciclo de estados del cobro (EST-01).
- RN-08 Seguimiento semanal; retraso → aviso a la Coordinación + acuerdo.
- RN-09 Mínimo dos requerimientos; traslado a los 180 días sin pago o por deterioro crediticio.
- RN-10 Derecho de petición primero; tutela solo si la entidad no responde; el sistema solo registra la decisión.
- RN-11 Tramos del IBC: 100 % (días 1–2, empresa), 67 % (3–90, EPS), 50 % (91–180, EPS), trámite de pensión desde el día 181. El IBC se ingresa al calcular.
- RN-12 Día 120: concepto de rehabilitación → AFP (fuera) + correo al colaborador; si no hay concepto, se registra la falta; a los 180 días, suspensión del pago.
- RN-13 Ausentismo al SG-SST en los primeros 3 días del mes; reporte mensual de prolongadas por hito.
- RN-14 Se archiva solo con el pago identificado y conciliado; antes se elimina la epicrisis.
- RN-15 El colaborador y las entidades no usan el sistema; no hay integración con los portales.

**Requisitos no funcionales** (F1 §2.6, F5 §5.3; no hay una sección de RNF propia):
- RNF-01 Aplicación web sin instalación, usable desde varias sedes.
- RNF-02 Autenticación con el correo institucional (Supabase Auth).
- RNF-03 Historia clínica y epicrisis restringidas al auxiliar; bucket privado al que solo accede el servidor.
- RNF-04 Notificaciones por correo institucional (SMTP).
- RNF-05 HTTPS entre navegador, servidor y Supabase.
- RNF-06 Node.js + Express, MVC con Persistencia, Supabase.
- ❓ No hay RNF de rendimiento, disponibilidad, respaldo, auditoría ni retención de datos. El procedimiento menciona «consultar periodos superiores a 3 años» (F1 §2.1), pero no se convierte en requisito.

## 7. Pendientes ya registrados por el equipo (F2, F3 §17)

1. Correo del colaborador. 2. Cómo se reconoce al auxiliar. 3. Catálogos de entidades y colaboradores. 4. Fechas de las alertas, umbral «por vencer» y festivos. 5. Fórmula del IBC. 6. Filtros de la consulta de estados. 7. Columnas del reporte de ausentismo. 8. Cómo se sabe que un pago está «identificado y conciliado».
