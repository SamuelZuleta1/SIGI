# Guion de sustentación — roles de SIGI

> Guion corto para explicar al profesor qué hace cada rol y mostrar el flujo en la aplicación.
> Caso de demostración: **incapacidad n.º 5873** (ya registrada en la base de datos de pruebas, sin verificar).
> Entorno: **no productivo**. Las cuentas son las de demostración `@sigi.test` (acceso rápido en el login).

---

## 1. Idea central (decir primero, 20 segundos)

> «SIGI sigue una incapacidad desde que llega hasta que se archiva. Cada persona hace solo su parte, y el sistema
> no deja que otro rol haga lo que no le corresponde. Así la empresa no pierde el dinero que tiene que recuperar
> de la EPS o la ARL.»

---

## 2. Los cinco roles, en una frase cada uno

| # | Rol | Frase para decir | Cuenta de demo |
| --- | --- | --- | --- |
| 1 | **Personal receptor** | «Recibe la incapacidad y los documentos. Solo registra, no decide.» | `receptor1@sigi.test` |
| 2 | **Líder / Jefe inmediato** | «Registra quién reemplaza al colaborador mientras está incapacitado.» | `lider1@sigi.test` |
| 3 | **Auxiliar de Administración de Personal** | «Es el usuario principal: verifica, radica, cobra y hace seguimiento.» | `auxiliar1@sigi.test` |
| 4 | **Contabilidad y Tesorería** | «Registra los pagos que consigna la EPS o la ARL.» | `contabilidad1@sigi.test` |
| 5 | **Cartera y Jurídica** | «Decide si se recupera el dinero por vía jurídica o se da de baja.» | `cartera1@sigi.test` |

**Actores sin cuenta** (se mencionan, no entran al sistema):
- **Coordinación de Administración de Personal**: recibe avisos de citación y de retraso de pagos. Le llegan **correos** del sistema.
- **SG-SST**: recibe el **reporte de ausentismo** (se genera desde Reportes).
- **Gestión Documental**: recibe las incapacidades pagadas para **archivo**.
- **Colaborador, EPS, ARL, AFP**: no usan SIGI. Se comunican por correo o por sus propios portales.

> Frase clave: «El colaborador no usa el sistema, y SIGI no se conecta con los portales de las EPS. El personal radica y cobra en esos canales, y SIGI registra el resultado.»

---

## 3. Flujo del caso 5873 (de principio a fin)

Puedes contar la historia en orden. En cada paso: **entrar con la cuenta → mostrar la pantalla → decir la frase**.

### Paso 1 — Personal receptor (ya hecho en el caso)
- **Cuenta:** `receptor1@sigi.test`
- **Pantalla:** *Registrar incapacidad* y luego *Registrar documentos* (menú lateral).
- **Qué hizo:** registró la incapacidad 5873 (enfermedad laboral, 10 días, ARL SURA, recibida el 27-nov-2026). Antes de presentar, confirma en *Registrar documentos* que los archivos aparecen; la base de datos no los muestra en este resumen.
- **Qué decir:** «El receptor solo registra. Le pide el número de la incapacidad y sube lo que llegó. No puede verificar ni cobrar: esos botones no le aparecen.»
- **Mostrar:** en *Registrar documentos*, escribir `5873` en «Incapacidad n.º». Es la pantalla de tu captura anterior.

### Paso 2 — Líder / Jefe inmediato
- **Cuenta:** `lider1@sigi.test`
- **Pantalla:** *Reemplazo* (menú) o la ficha de la incapacidad 5873 → *Reemplazo*.
- **Qué decir:** «El jefe registra quién cubre el trabajo del colaborador. Es un dato de contexto; no afecta el cobro.»
- **Mostrar:** el formulario de reemplazo. Si no quieres registrarlo en vivo, solo muestra que la pantalla existe y que el líder no ve nada más.

### Paso 3 — Auxiliar: verificación documental (el núcleo del flujo)
- **Cuenta:** `auxiliar1@sigi.test`
- **Pantalla:** *Verificación* → incapacidad 5873.
- **Qué decir:** «Aquí empieza el trabajo real. El auxiliar revisa si la documentación está completa. Si falta algo, SIGI avisa por correo con 3 días hábiles de plazo. Si no llega, avisa a Coordinación.»
- **Mostrar:** el estado de documentos de la 5873 (hoy no tiene faltantes) y, si quieres, marca la verificación como completa.
- **Dato a favor:** la historia clínica y la epicrisis **solo las ve el auxiliar**. Si entras con el receptor, esos documentos no aparecen.

### Paso 4 — Auxiliar: radicación y seguimiento
- **Pantalla:** *Radicación* → 5873 (registrar la radicación ante la ARL).
- **Qué decir:** «Ahora el auxiliar radica ante la ARL en su portal. SIGI no se conecta con el portal: solo guardamos la fecha y el resultado. Si la ARL rechaza, también se registra, y el sistema avisa si el plazo se vence.»
- **Pantalla extra:** *Seguimiento* → muestra que se pueden registrar llamadas, acuerdos y requerimientos.

### Paso 5 — Contabilidad y Tesorería: pago consignado
- **Cuenta:** `contabilidad1@sigi.test`
- **Pantalla:** *Pagos consignados*.
- **Qué decir:** «Cuando la ARL consigna el dinero, Contabilidad lo registra en SIGI. Solo puede registrar pagos y anular un pago consignado si se equivocó. No toca el estado de la incapacidad.»
- **Mostrar:** el formulario de registro de pago consignado.

### Paso 6 — Auxiliar: conciliación
- **Cuenta:** `auxiliar1@sigi.test`
- **Pantalla:** *Conciliación* → elegir la entidad (ARL SURA).
- **Qué decir:** «El auxiliar cruza lo que consignó la ARL con las incapacidades pendientes de pago. Así se sabe qué ya se pagó y qué sigue abierto.»
- **Mostrar:** la lista de pagos de la entidad al elegirla.

### Paso 7 — Cartera y Jurídica (solo si no se pagó)
- **Cuenta:** `cartera1@sigi.test`
- **Pantalla:** *Cartera* → decisión de la incapacidad.
- **Qué decir:** «Cuando el cobro persuasivo no funciona, el caso pasa a Cartera y Jurídica. Ellos deciden si recuperan el dinero por vía jurídica o dan de baja la cuenta. SIGI no toma esa decisión sola.»
- **Nota:** en el caso 5873 no hace falta llegar a este paso. Menciónalo y muéstralo solo si el profesor pregunta.

### Paso 8 — Archivo y reportes (cierre)
- **Cuenta:** `auxiliar1@sigi.test`
- **Pantallas:** *Archivo* (incapacidad pagada) y *Reportes* (ausentismo para SG-SST).
- **Qué decir:** «Cuando la incapacidad está pagada, el auxiliar la archiva y Gestión Documental la recibe. El reporte de ausentismo lo recibe SG-SST. Así cerramos el ciclo.»

---

## 4. Cómo demostrar la separación de roles (lo más valioso para el profesor)

Frase: «En SIGI cada rol solo ve y hace lo que le corresponde. Esto se diseñó a partir de los diagramas de secuencia.»

Prueba rápida en vivo:
1. Entra como **receptor1** y abre la incapacidad 5873. Pregunta: ¿puede ver la epicrisis o verificar? (No.)
2. Entra como **auxiliar1** y abre la misma incapacidad. Ahora sí aparecen verificación, radicación y cobro.
3. Entra como **contabilidad1**. Solo aparecen pagos consignados y conciliación.

> Si el profesor pregunta por qué no hay «administrador»: «El procedimiento del cliente no define un administrador. Cada área tiene solo las funciones que describe su proceso.»

---

## 5. Preguntas probables y respuesta corta

| Pregunta | Respuesta corta |
| --- | --- |
| ¿Por qué el receptor no verifica? | Verificar requiere criterio de la documentación. El procedimiento lo asigna al auxiliar. |
| ¿Por qué Contabilidad no cambia el estado? | El estado del cobro lo cambia el auxiliar. Contabilidad solo registra el dinero que llega. |
| ¿SIGI se conecta con las EPS? | No. Es decisión de alcance: el personal radica y cobra en los portales. SIGI registra el resultado. |
| ¿Qué pasa si se vence el plazo? | SIGI advierte, pero no impide radicar. |
| ¿Quién ve la historia clínica? | Solo el auxiliar. Es un requisito de la historia HU-02. |

---

## 6. Antes de presentar (checklist)

- [ ] Abrir la app: `codigo/` → `npm start` (o la URL de Vercel si ya está desplegada).
- [ ] Probar el acceso rápido con cada cuenta antes de la sustentación.
- [ ] Confirmar que la incapacidad **5873** sigue sin verificar (si ya se avanzó en pruebas anteriores, registra otra con `receptor1` y usa esa).
- [ ] Tener Mailpit abierto si vas a mostrar los correos a Coordinación.
- [ ] Llevar la lista de cuentas de demo y la contraseña en papel (no en la pantalla).
