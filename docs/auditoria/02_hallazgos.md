# 02 · Hallazgos de la auditoría — SIGI

> Fase 1. Fecha: 2026-11-16. Ninguno de estos hallazgos se corrigió: todos esperan tu decisión.
> En cada hallazgo, **Hechos** es lo que dicen las fuentes, citadas. **Suposición / recomendación** es mi interpretación y no forma parte del sistema hasta que la apruebes.
> Abreviaturas: F1 = PDF de la Segunda Entrega; F2 = Historias de Usuario; F4 = `.drawio`; P-x = pendiente que el equipo ya registró (F2, «Pendientes de definición»).

## Resumen

| Severidad | Hallazgos | Pendientes P-x |
| --- | --- | --- |
| Crítico | H-01, H-03 | P-2, P-3 |
| Mayor | H-02, H-04, H-05, H-06, H-08, H-12, H-17, H-23 | P-1, P-4, P-5, P-8 |
| Menor | H-07, H-09, H-10, H-11, H-13, H-14, H-15, H-16, H-18, H-19, H-20, H-21, H-22 | P-6, P-7 |
| **Total** | **23** (2 críticos, 8 mayores, 13 menores) | **8** |

**Crítico** = impide implementar una HU de alta prioridad como está escrita, o afecta la seguridad. **Mayor** = contradicción entre fuentes o falta de un dato que cambia el comportamiento. **Menor** = imprecisión que se puede resolver con una decisión corta.

---

## Críticos

### H-01 · El cambio de estado a «transcrita» no está en el caso de uso ni en el diagrama de secuencia
- **Fuente A:** HU-10, crit. 1 y 2: «cambia el estado de la incapacidad a "transcrita"». EST-01 (F1 p. 71): `registrarRadicacion(radicado, evidencia) / guardarRadicacion(...); estado := transcrita`. F1 §6.3 dice que el atributo estado sale de «actualizarEstado, DS-06».
- **Fuente B:** CU-06 (F1 p. 16): las postcondiciones solo dicen «el radicado y la evidencia quedan guardados»; no hablan del estado. DS-04/CO-04 terminan en `guardarRadicacion(radicado, evidencia) → radicacionGuardada()`, sin `actualizarEstado(…, transcrita)` (confirmado en el PDF a 260 ppp y en F4). Entre las 42 operaciones del Control no está `actualizarEstado(idIncapacidad, transcrita)`.
- **Por qué es un problema:** HU-13 y HU-14 parten de «Dado que la incapacidad está transcrita». Si la radicación no cambia el estado, el ciclo de cobro no empieza. Además, el estado se llama «transcrita» y lo asigna la radicación, mientras que la transcripción (CU-07) es un «extend» que no siempre ocurre: una incapacidad que nunca se transcribe quedaría como «transcrita».
- **Hechos:** EST-01 y HU-10 piden el cambio; CU-06, DS-04, CO-04 y CL-01 no lo tienen.
- **Suposición / recomendación:** tomar EST-01 y HU-10 como la regla, y que `registrarRadicacion` también actualice `estado = transcrita` dentro de la misma operación del grupo `radicacion`. No hay que agregar una operación nueva al diagrama de clases.
- **Decisión que necesito:** (a) ¿La radicación pone el estado en «transcrita»? (b) ¿Se mantiene el nombre «transcrita» aunque no haya habido transcripción, o se renombra (por ejemplo, «radicada»)? Renombrarlo cambia EST-01, HU-10, HU-11 y HU-13/14.

### H-03 · Roles y permisos: quién puede hacer qué
- **Fuente A:** HU-01 y Visión §5.3: los usuarios internos que inician sesión son 8 roles, incluidos Coordinación, SG-SST y Gestión Documental. F3 §14: «No se definen permisos por rol más allá de la restricción [de la epicrisis]; agregar perfiles es un requisito nuevo».
- **Fuente B:** en los 14 DS, Coordinación, SG-SST y Gestión Documental **solo reciben correos**: no envían ningún mensaje a la Interfaz. CL-01, relación 14, solo asocia con la Interfaz a Receptor, Líder, Auxiliar, Contabilidad y Cartera. Varias operaciones pertenecen a un actor concreto: `registrarDecision` (Cartera), `registrarPagosConsignados` (Contabilidad), `registrarReemplazo` (Líder). HU-02 exige saber quién es el auxiliar (P-2).
- **Por qué es un problema:** sin roles, cualquier usuario autenticado podría, por ejemplo, registrar la decisión jurídica o los pagos consignados. Y para cumplir HU-02 el sistema tiene que distinguir al auxiliar, lo que ya es un rol. Esto se decide antes del Módulo 1.
- **Hechos:** la documentación pide restringir solo la epicrisis y la historia clínica, y no modela roles.
- **Suposición / recomendación:** la opción mínima justificada es guardar un rol por usuario, solo para identificar al auxiliar (HU-02), y dejar las demás operaciones abiertas a cualquier usuario autenticado, como dice F3 §14. Restringir cada operación a su actor sería un requisito nuevo.
- **Decisión que necesito:** (a) ¿Cómo se identifica al auxiliar (P-2): una lista de correos en la configuración, una tabla de roles o metadatos de Supabase Auth? (b) ¿Las operaciones de Cartera, Contabilidad y Líder quedan abiertas a cualquier usuario autenticado? (c) ¿Coordinación, SG-SST y Gestión Documental necesitan cuenta, si no tienen ninguna pantalla?

---

## Mayores

### H-02 · ¿Una incapacidad rechazada puede ir a cobro persuasivo?
- **Fuente A:** CU-12 (precondición): «La incapacidad tiene demora de pago **o rechazo**». F1 §3.1: CU-12 extiende a CU-11 «solo si hay demora o rechazo». HU-18 crit. 1: «Dado que la incapacidad tiene demora o rechazo».
- **Fuente B:** EST-01: `registrarRequerimiento`, `trasladarACartera` y `registrarDecision` son transiciones internas del estado **Cobrada**; desde **Rechazada** la única salida es una nueva radicación (→ Transcrita). AD-01: «[la entidad rechaza]» vuelve a «Radicar y transcribir», y solo «[el pago supera el tiempo prometido]» lleva a CU-12. HU-14: tras el rechazo «pido una nueva transcripción». Además, el «extend» va hacia CU-11 (seguimiento de cobradas), pero el rechazo ocurre en CU-10.
- **Por qué es un problema:** cambia qué estados permiten registrar requerimientos y traslados, y si una rechazada puede terminar en «pagada» sin pasar por «cobrada».
- **Decisión que necesito:** ¿El cobro persuasivo se aplica (a) solo a las cobradas con demora (EST-01 y AD-01), o (b) también a las rechazadas (CU-12 y HU-18)? Si es (b), hay que agregar transiciones en EST-01 y corregir el «extend».

### H-04 · HU-02: no hay ningún flujo para ver o abrir un documento
- **Fuente A:** HU-02 crit. 1 y 2: un usuario que no es el auxiliar «intenta abrirlo» y no lo ve; el auxiliar «puede ver la historia clínica y la epicrisis».
- **Fuente B:** ningún CU, DS ni operación de la Vista permite abrir o descargar un documento. Lo más cercano es `obtenerExpediente` (DS-03), que devuelve el expediente al Control para compararlo. La «historia clínica» no está en la lista de documentos obligatorios (F1 §2.8), y Documento.tipo no tiene valores definidos.
- **Por qué es un problema:** no se puede probar el crit. 1 si no existe la acción de abrir un documento. Agregar una pantalla de «ver documento» sería inventar una funcionalidad.
- **Decisión que necesito:** (a) ¿Se agrega una operación para ver o descargar un documento (servida por el servidor con una URL firmada, nunca accediendo directo al bucket)? ¿Dentro de qué grupo: `verificacion`? (b) ¿Cuáles son los valores de Documento.tipo (soporte, epicrisis, historia clínica, FURIPS, certificado de nacido vivo, registro civil, documento de identidad…)?

### H-05 · Un solo valorEPS para dos tramos (67 % y 50 %)
- **Fuente A:** CU-13 A1 y A2 y DS-09: `calcularValorEPS(67% IBC)` y `calcularValorEPS(50% IBC)` pueden ejecutarse los dos.
- **Fuente B:** CL-01: Incapacidad tiene un único `valorEPS`; `guardarCalculo(ibc, valorEmpresa, valorEPS)`.
- **Por qué es un problema:** no está definido si valorEPS es la suma de los tramos, ni cómo se pasa del IBC a un valor por día (P-5). Es un cálculo de dinero: no se puede suponer.
- **Decisión que necesito:** junto con P-5: ¿valorEPS = (días 3–90 × 67 % × IBC diario) + (días 91–180 × 50 % × IBC diario)? ¿IBC diario = IBC/30? ¿Aplica igual a ARL y a licencias de maternidad y paternidad (que normalmente se pagan al 100 %)?

### H-06 · El trámite de pensión no tiene dónde guardarse
- **Fuente A:** CU-13 A3 y postcondición: «el trámite de pensión queda marcado». DS-09: `marcarTramitePension()`. HU-21: «el sistema marca el trámite de pensión».
- **Fuente B:** CL-01: Incapacidad no tiene ningún atributo para eso, y `guardarCalculo(ibc, valorEmpresa, valorEPS)` no lo incluye.
- **Por qué es un problema:** la postcondición no se puede cumplir ni probar.
- **Decisión que necesito:** ¿Se agrega el atributo `tramitePension` (booleano) a Incapacidad y como parámetro de `guardarCalculo`? ¿O «marcar» significa solo mostrarlo en pantalla, sin guardarlo?

### H-08 · Segundo llamado: ¿lo registra el auxiliar o lo dispara el sistema a los 3 días hábiles?
- **Fuente A:** CU-05 A1, DS-03 y HU-08: el auxiliar hace el segundo llamado fuera del sistema y luego lo **registra** (`registrarSegundoLlamado`).
- **Fuente B:** EST-02: transición temporizada `after(3 días hábiles) [el colaborador no entrega] / guardarSegundoLlamado ^notificarCitacion(Coordinación)`: el sistema la ejecuta solo, sin acción del auxiliar.
- **Por qué es un problema:** la opción B obliga a tener un proceso programado (*cron*) que no aparece en ningún componente (CMP-01) y necesita la fecha del aviso de faltantes, que no se guarda (P-4).
- **Suposición / recomendación:** tomar el CU, el DS y la HU (registro manual), y que el plazo de 3 días hábiles solo aparezca como alerta (HU-12). EST-02 se leería como «el evento ocurre después de 3 días hábiles».
- **Decisión que necesito:** ¿Manual (A) o automático (B)?

### H-12 · Pagos parciales frente al paso a «pagada»
- **Fuente A:** CL-01, relación 9: Pago 0..*, «pueden ser pagos parciales». HU-15 crit. 3: «Una incapacidad puede tener varios pagos».
- **Fuente B:** DS-06/07/08 y EST-01: cualquier `registrarPago` lleva a `actualizarEstado(pagada)`. No se compara con el valor esperado (valorEPS).
- **Por qué es un problema:** con un pago parcial, la incapacidad quedaría «pagada», saldría del seguimiento semanal (HU-16) y podría archivarse sin estar completamente pagada.
- **Decisión que necesito:** (a) ¿Cualquier pago la deja «pagada» (como está modelado)? (b) ¿O solo cuando el auxiliar indica que es el pago total? (c) ¿O cuando la suma de los pagos alcanza valorEPS? Las opciones (b) y (c) cambian EST-01.

### H-17 · Archivo: qué pasa con la historia clínica y qué se envía por correo a Gestión Documental
- **Fuente A:** CU-17 A1 y DS-13: «[tiene historia clínica **o** epicrisis] → eliminarEpicrisis». F1 OBN-7 y CAR-11 solo hablan de eliminar la epicrisis.
- **Fuente B:** HU-29 crit. 2: «elimina la epicrisis si la tiene, **envía la incapacidad por correo** a Gestión Documental». No se define el contenido del correo `enviarParaArchivo`: ¿solo los datos o los documentos adjuntos?
- **Por qué es un problema:** (1) si la historia clínica no se elimina, queda guardada después del archivo y no está claro si debe borrarse. (2) Si el correo lleva adjuntos, los documentos saldrían del bucket privado por correo, lo que choca con RNF-03 / HU-02.
- **Decisión que necesito:** (a) ¿Al archivar se elimina solo la epicrisis o también la historia clínica? (b) ¿El correo a Gestión Documental lleva solo los datos de la incapacidad (sin adjuntos)?

### H-23 · Conciliación: no hay regla para comparar los pagos
- **Fuente A:** CU-15 paso 4 y DS-11: `identificarPagos(entidad, detallePagos)` → `compararPagos()` → todos identificados o saldos pendientes. HU-26: «cuando ingreso el detalle de pagos de una entidad».
- **Fuente B:** no se define el formato del `detallePagos` (¿lo escribe el auxiliar, carga un archivo, lo selecciona de los pagos registrados?) ni con qué campos se cruza con `PagoConsignado` (entidad, colaborador, díasPagados, valor). PagoConsignado guarda «colaborador» como texto, no como relación con Colaborador ni con Incapacidad (relaciona con P-8).
- **Por qué es un problema:** es el núcleo de HU-26 y de HU-29 («identificado y conciliado»). Sin la regla no se puede escribir el test.
- **Decisión que necesito:** (a) ¿Qué es el detalle de pagos de la entidad y cómo se ingresa? (b) ¿Cuándo se considera identificado un pago consignado (coincidencia de colaborador + valor + días)? (c) ¿Cómo queda marcada como conciliada cada incapacidad (P-8)?

---

## Menores

### H-07 · No hay requisitos no funcionales de calidad
- **Hechos:** F1 y la Visión solo definen RNF de plataforma y seguridad. No hay rendimiento, disponibilidad, auditoría (quién registró qué y cuándo) ni retención. F1 §2.1 menciona «consultar periodos superiores a 3 años».
- **Decisión que necesito:** ¿Se agrega algo (por ejemplo, guardar el usuario y la fecha de cada registro para cumplir OBN-4 de trazabilidad)? Si no, no se implementa nada de esto.

### H-09 · ¿Hay que verificar la documentación antes de radicar?
- **Fuente A:** AD-01: radicar solo tras «[la documentación está completa]». HU-06: «verificar … **para poder radicarla**».
- **Fuente B:** CU-06: la única precondición es CU-01. EST-01 no exige que esté verificada. D-10: las advertencias no bloquean.
- **Decisión que necesito:** ¿Radicar sin verificar se (a) permite, (b) permite con una advertencia, o (c) bloquea? Recomendación: (a) o (b), por coherencia con D-10.

### H-10 · Varios mensajes no llevan el identificador de la incapacidad
- **Hechos (F4 y F1 §6.4):** `registrarRadicacion(radicado, evidencia)`, `registrarRequerimiento(fundamentos)`, `registrarSeguimiento(evidencia)`, `registrarAcuerdo(acuerdo)`, `registrarConcepto(concepto)`, `registrarFaltaConcepto()`, `guardarEstado(cobrada, tiempoPago)`, `guardarRechazo(causal)`, `guardarPago(valor, fechaPago)`, `guardarTraslado(motivo)`, `guardarFaltantes(listaFaltantes)`, `guardarCalculo(...)`, `guardarDocumentos(documentos)`, `guardarRequerimiento`, `guardarSeguimiento`, `guardarAcuerdo`, `guardarConcepto`, `guardarFaltaConcepto()`.
- **Por qué es un problema:** sin el id no se sabe a qué incapacidad pertenece el registro. Agregarlo es una consecuencia necesaria, no una funcionalidad nueva.
- **Decisión que necesito:** ¿Apruebas agregar `idIncapacidad` como primer parámetro a esas operaciones, sin cambiarles el nombre?

### H-11 · ¿De dónde sale la fecha del pago?
- **Fuente A:** HU-15: «registro el pago con su valor **y su fecha**». `guardarPago(valor, fechaPago)`.
- **Fuente B:** `registrarPago(idIncapacidad, valor)` y CU-10 A1.2: «registra el pago con su valor».
- **Decisión que necesito:** ¿El auxiliar escribe la fecha del pago (como dice HU-15) o se usa la fecha del día del registro?

### H-13 · Mínimo de dos requerimientos y los «180 días»
- **Hechos:** HU-18 y RN-09 piden mínimo dos requerimientos antes del traslado; DS-08 lo modela como un loop, pero no dice si el sistema lo exige. «180 días sin pago» no dice desde qué fecha se cuentan (¿cobrada?, ¿radicación?, ¿fechaInicio?).
- **Decisión que necesito:** (a) Si hay menos de dos requerimientos, ¿el traslado se bloquea, se advierte o se permite? (Recomendación: advertir, por D-10.) (b) ¿Desde qué fecha se cuentan los 180 días, o solo es el motivo que escribe el auxiliar?

### H-14 · Después de «dar de baja» la incapacidad no tiene estado final
- **Hechos:** EST-01: tras `registrarDecision`, la incapacidad sigue en **Cobrada**. Seguiría saliendo en el seguimiento semanal (HU-16) y no puede archivarse (CU-17 exige «pagada»).
- **Decisión que necesito:** ¿Una incapacidad dada de baja debe dejar de salir en los pendientes de pago? Si es así, hace falta un estado o una marca. Hoy solo existe el atributo `decision`, que podría usarse para filtrar sin agregar un estado nuevo.

### H-15 · HU-09 pide más datos de los que devuelve DS-04
- **Fuente A:** HU-09: mostrar la entidad, **si permite transcripción digital o exige correo**, el plazo, y advertir si está **por vencer** o vencido.
- **Fuente B:** DS-04: `datosRadicacion(entidad, plazo, vencido)`: no incluye «por vencer» ni el canal de transcripción.
- **Decisión que necesito:** ¿Apruebas que la respuesta incluya `permiteTranscripcionDigital` (ya es atributo de Entidad) y el estado «por vencer» (umbral según P-4)?

### H-16 · Dos formas de ver el reporte de prolongadas
- **Hechos:** DS-10: `consultarReporteProlongadas → consultarReporte(prolongadas)`. DS-12: `generarReporte(prolongadas) → guardarReporte(prolongadas)`. No se dice si DS-10 lee el último reporte guardado o hace una consulta en vivo de las incapacidades de más de 90 días.
- **Decisión que necesito:** ¿DS-10 consulta en vivo (recomendado: así lo describe HU-22, «hay incapacidades de más de 90 días») o lee el último Reporte guardado?

### H-18 · Referencias internas rotas en el PDF
- **Hechos:** F1 §2.1 remite a «la sección 6» y «la sección 4.1» (son secciones de la Visión, no del PDF). F1 §6.2 dice «(sección 3)», y §6.5 dice «sección 3.3» y «sección 3.4», para tablas que están en §6.4. F1 §6.3 cita la «decisión I-12», que no existe (las decisiones son D-01 a D-14).
- **Decisión que necesito:** solo se informa; no afecta el código. ¿Quieres que lo anote para una corrección de la entrega?

### H-19 · Dos versiones del diagrama de casos de uso
- **Hechos:** F1 Figura 1 (p. 10) y `docs/modelado/01_Documentos/imagenes/Diagrama_Casos_de_Uso_SIGI.png` están hechos con herramientas distintas y tienen otra disposición. En el PNG algunas asociaciones atraviesan otros casos de uso y es ambiguo a cuál llegan (❓).
- **Decisión que necesito:** ¿Cuál es la versión oficial? Recomendación: la del PDF.

### H-20 · CU-07 está dentro del sistema aunque el sistema no participa
- **Hechos:** CU-07 está dentro de la frontera de SIGI (F1 p. 10), pero F1 §7.3 dice «En la transcripción el sistema no participa», y su flujo no tiene ninguna respuesta del sistema.
- **Decisión que necesito:** ninguna para el código (CU-07 no se implementa). Solo es una observación de modelado.

### H-21 · Legibilidad del PDF y equivalencia con los `.drawio`
- **Hechos:** el texto de los diagramas del PDF es demasiado pequeño a 150 ppp. El detalle de los mensajes se tomó de los `.drawio`, y solo se comprobó contra el PDF en DS-04.
- **Decisión que necesito:** ¿Confirmas que los `.drawio` de `docs/modelado/` tienen el mismo contenido que las figuras del PDF y pueden usarse como fuente?

### H-22 · Calidad de las HU (formato, criterios verificables e INVEST)
- **Formato:** las 30 siguen «Como … quiero … para …». ✅ HU-01 usa un rol compuesto («usuario interno: 8 roles»).
- **Criterios no verificables o sin métrica:**
  - HU-07 crit. 2, «vuelve a quedar lista para verificarse»: no dice qué dato cambia. Se respalda en EST-02 (vuelve a «Documentos registrados»).
  - HU-12, «por vencer»: sin umbral (P-4).
  - HU-16, «seguimiento semanal»: nada exige ni mide la periodicidad; solo se registra.
  - HU-27, «consolida los datos»: sin columnas (P-7).
  - No hay criterios con «rápido» o «fácil».
- **INVEST:**
  - **Pequeña (S):** HU-12 agrupa 8 tipos de plazo distintos; conviene dividirla en una HU por plazo o por grupo. HU-22 junta consultar el reporte y registrar el concepto. HU-29 junta consultar las pagadas y archivar.
  - **Independiente (I):** HU-13 y HU-14 dependen de HU-10 (estado transcrita, ver H-01). HU-15 se reutiliza desde HU-16 y HU-19. HU-17 depende de HU-16. HU-19 depende de HU-18. HU-29 depende de HU-26 (P-8). HU-30 depende de HU-29. Son dependencias de proceso y ya están ordenadas en el plan de 15 días.
  - **Estimable / testeable (E/T):** HU-21 (P-5, H-05, H-06), HU-26 (H-23) y HU-27 (P-7) no se pueden estimar hasta resolverlas.
  - HU-05: no dice qué pasa si se registra un segundo reemplazo (¿se rechaza o se reemplaza el anterior?).
- **Decisión que necesito:** ¿Divido HU-12 en varias HU, o la dejo como está y hago un test por cada tipo de plazo? Y para HU-05: ¿un segundo registro se rechaza o actualiza el reemplazo?

---

## Pendientes ya registrados por el equipo (F2 / F3 §17), con severidad

| P | Tema | HU | Severidad | Decisión que necesito |
| --- | --- | --- | --- | --- |
| P-1 | Correo del colaborador (Colaborador solo tiene `nombre`) | HU-07, 22, 23, 24 | Mayor | ¿Se agrega `correo` (y ¿`documento de identidad`?) a Colaborador? |
| P-2 | Cómo se reconoce al auxiliar | HU-02 | **Crítico** (con H-03) | Ver H-03 (a). |
| P-3 | Catálogos de entidades y colaboradores: no hay CU para administrarlos | HU-03, 09, 12 | **Crítico** (bloquea el Módulo 2) | ¿Carga inicial por *seed* o script (los plazos de F1 / §5.2.1) sin pantalla? ¿O se crean colaboradores al vuelo al registrar una incapacidad? Una pantalla de administración sería un CU nuevo. |
| P-4 | Fechas de las alertas, umbral «por vencer» y festivos | HU-08, 12 | Mayor | Desde qué fecha corre cada plazo; umbral (por ejemplo, 20 % o N días); calendario de festivos de Colombia. Faltan atributos: fecha del aviso de faltantes y fecha de nacimiento (licencia de paternidad). «Envío de la incapacidad en 2 días»: ¿desde fechaInicio hasta fechaRecepcion? |
| P-5 | Fórmula del IBC | HU-21 | Mayor | Ver H-05. |
| P-6 | Filtros de la consulta de estados | HU-11 | Menor | ¿Por estado, entidad, colaborador y rango de fechas? ¿Se muestran también las que están en «sin valor»? |
| P-7 | Columnas del reporte de ausentismo | HU-27 | Menor | Lista de columnas. ¿El reporte se guarda con su contenido? Reporte solo tiene `tipo` y `periodo`. |
| P-8 | Pago «identificado y conciliado» por incapacidad | HU-29 | Mayor | Ver H-23 (c). |

---

## Lista de preguntas (en orden de prioridad)

1. **H-01:** ¿La radicación pone el estado en «transcrita»? ¿Se mantiene ese nombre?
2. **H-03 / P-2:** ¿Cómo se identifica al auxiliar? ¿Las demás operaciones quedan abiertas a cualquier usuario autenticado? ¿Coordinación, SG-SST y Gestión Documental necesitan cuenta?
3. **P-3:** ¿Cómo se cargan las entidades (con sus plazos) y los colaboradores?
4. **P-1:** ¿Se agrega el correo (y la identificación) del colaborador?
5. **H-02:** ¿El cobro persuasivo se aplica solo a las cobradas con demora, o también a las rechazadas?
6. **H-04:** ¿Se agrega una operación para ver o descargar documentos? ¿Cuáles son los tipos de documento?
7. **H-08:** ¿El segundo llamado es manual o automático?
8. **H-12:** ¿Con qué pago queda «pagada» una incapacidad?
9. **H-05 / P-5:** ¿Cuál es la fórmula del IBC diario, cómo se suma valorEPS y cómo aplica a ARL y licencias?
10. **H-06:** ¿Se guarda `tramitePension`?
11. **H-23 / P-8:** ¿Cuál es el formato del detalle de pagos, la regla de identificación y cómo se marca una incapacidad conciliada?
12. **H-17:** ¿Se elimina también la historia clínica? ¿El correo a Gestión Documental va sin adjuntos?
13. **P-4:** Fechas de inicio de cada plazo, umbral «por vencer», festivos, y los atributos de fecha que faltan.
14. **H-09, H-13:** ¿Radicar sin verificar, o trasladar con menos de dos requerimientos, se bloquea, se advierte o se permite?
15. **H-10, H-11, H-15:** ¿Apruebas agregar `idIncapacidad` a los mensajes, la fecha del pago escrita por el auxiliar, y «por vencer» + canal en la preparación de la radicación?
16. **H-14, H-16:** Qué pasa con las dadas de baja; si el reporte de prolongadas es en vivo o guardado.
17. **P-6, P-7, H-22, H-07:** Filtros, columnas del reporte de ausentismo, dividir HU-12, segundo reemplazo, auditoría o RNF.
18. **H-19, H-21:** ¿Diagrama de CU oficial = el del PDF? ¿Los `.drawio` equivalen al PDF?
