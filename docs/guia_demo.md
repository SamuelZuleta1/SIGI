# Guía de la demostración — SIGI

Recorrido completo de una incapacidad según el proceso general (AD-01), con los usuarios de demostración
(DA-02). El mismo recorrido (todo salvo el reemplazo del paso 3) está automatizado en
`codigo/tests/integracion/recorrido-completo.int.test.js` (T-31): si esa prueba pasa, la demostración funciona.

## 1. Antes de empezar

```bash
cd codigo
npm install
npm run db:estado      # todas las migraciones aplicadas en la nube
npm run db:usuarios    # los 10 usuarios @sigi.test (no duplica)
npm run test:int -- tests/integracion/recorrido-completo.int.test.js   # ensayo general (~30 s)
npm run dev            # http://localhost:3000
```

- **Correos:** con Mailpit en marcha (`SMTP_HOST=localhost`, `SMTP_PORT=54325` en `.env`), cada aviso se ve en su
  bandeja web. Sin servidor SMTP, los registros se guardan igual y la pantalla avisa que no salió el correo.
- **Entrar:** la pantalla de inicio de sesión tiene un botón de acceso rápido por actor (usa `DEMO_PASSWORD`).
  Conviene abrir una ventana (o perfil del navegador) por actor para no cerrar sesión a cada paso.
- **Datos:** use un colaborador con un nombre fácil de buscar (por ejemplo «Demo Ana Gómez») y la entidad Nueva EPS.

| Actor | Usuario | Menú |
| --- | --- | --- |
| Personal receptor | `receptor1@sigi.test` | Registrar incapacidad, Registrar documentos |
| Líder / Jefe inmediato | `lider1@sigi.test` | Reemplazo |
| Auxiliar de Administración de Personal | `auxiliar1@sigi.test` | Todo el proceso |
| Contabilidad y Tesorería | `contabilidad1@sigi.test` | Pagos consignados |
| Cartera y Jurídica | `cartera1@sigi.test` | Cobro jurídico |

Coordinación, SG-SST y Gestión Documental no entran a SIGI: solo reciben correos.

## 2. Recorrido (AD-01)

| # | Actor | Pantalla | Qué hacer | Qué se ve | HU |
| --- | --- | --- | --- | --- | --- |
| 1 | Receptor | Registrar incapacidad | Enfermedad general, 5 días, Nueva EPS, correo del colaborador | Confirmación con el n.º de la incapacidad | HU-03 |
| 2 | Receptor | Registrar documentos | Subir solo el soporte de la incapacidad | El receptor no ve la verificación (permisos) | HU-04, HU-02 |
| 3 | Líder | Reemplazo | Registrar quién reemplaza al colaborador | El líder no ve tipo ni entidad | HU-05 |
| 4 | Auxiliar | Verificar documentación | Abrir la incapacidad: falta la epicrisis → «Notificar faltantes» | Correo al colaborador con la lista | HU-06, HU-07 |
| 5 | Auxiliar | Registrar documentos → Verificar | Subir la epicrisis y confirmar la verificación | Documentación completa | HU-06 |
| 6 | Auxiliar | Radicación | Número de radicado + pantallazo del portal | Estado «Transcrita» | HU-10 |
| 7 | Auxiliar | Cobro | Respuesta de la entidad: **Rechazó**, con la causal | Estado «Rechazada»; la radicación ofrece radicar de nuevo | HU-14 |
| 8 | Auxiliar | Radicación | Nueva radicación | Vuelve a «Transcrita» | HU-10 |
| 9 | Auxiliar | Cobro | **Aprobó**, tiempo de pago 30 días | Estado «Cobrada» y fecha prometida | HU-13 |
| 10 | Auxiliar | Seguimiento | Registrar el seguimiento con evidencia (ver nota de la demora) | Demora en días; correo a Coordinación | HU-16, HU-17 |
| 11 | Auxiliar | Seguimiento → Requerimientos | Dos requerimientos y «Trasladar a Cartera» | Correo a Cartera y Jurídica | HU-18, HU-19 |
| 12 | Cartera | Cobro jurídico | Decidir «Recuperar el cobro» | La decisión queda registrada | HU-20 |
| 13 | Auxiliar | Requerimientos | Registrar el pago (420.000, hoy) | Estado «Pagada» | HU-15 |
| 14 | Contabilidad | Pagos consignados | Nueva EPS: el colaborador, 5 días, 420.000 | Correo al auxiliar | HU-25 |
| 15 | Auxiliar | Conciliación | Elegir Nueva EPS: el pago aparece «Coincide» → Conciliar | Confirmación; correo a Contabilidad | HU-26 |
| 16 | Auxiliar | Archivo | «Por archivar» → Archivar | Se elimina la epicrisis; correo a Gestión Documental | HU-29 |
| 17 | Auxiliar | Archivo | Marcar la entrega de los documentos físicos | Pestaña «Enviadas»; ciclo cerrado | HU-30 |
| 18 | Auxiliar | Consultar estados | Buscar el colaborador | «Pagada» con la marca «Enviada a Gestión Documental» | HU-11 |

**Nota de la demora (paso 10).** La demora aparece solo cuando ya pasó la fecha prometida (cobrada + tiempo de
pago), así que no se puede ver el mismo día. Para mostrarla en vivo, después del paso 9 retroceda la fecha de
cobrada desde el editor SQL del panel de Supabase (es lo mismo que hace la prueba T-31):

```sql
update incapacidad set fecha_cobrada = (now() at time zone 'America/Bogota')::date - 40
where id = <n.º de la incapacidad>;
```

## 3. Pantallas complementarias (fuera de AD-01)

- **Alertas de plazos** (HU-12): plazos de transcripción vencidos o por vencer, segundo llamado y hitos de las prolongadas.
- **Reconocimiento** (HU-21): con el IBC, el reparto entre la empresa y la entidad por tramos.
- **Prórrogas** (DA-50): en Registrar incapacidad → «Prórroga», buscar la anterior por su n.º y registrar la continuación. Los días se suman al caso: el reconocimiento de la prórroga ya no paga los días 1–2 a la empresa, y un caso de 60 + 40 días aparece en Prolongadas como uno solo de 100 días.
- **Reglas por tipo** (DA-51): una licencia la paga la EPS al 100 %; un accidente laboral, la empresa el día 1 y la ARL al 100 % desde el día 2.
- **Prolongadas** (HU-22 a HU-24): incapacidades de más de 90 días, concepto de rehabilitación y suspensión del pago
  (requieren una incapacidad larga con fecha de inicio antigua).
- **Reportes** (HU-27, HU-28): ausentismo del mes (se envía a SG-SST) y prolongadas.

## 4. Al terminar

Las pruebas borran sus propios datos. Lo creado a mano en la demostración queda en la nube: bórrelo desde el
panel (tabla `incapacidad`, en cascada, y luego el colaborador y el pago consignado) si no se quiere conservar.
