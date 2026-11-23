// Mejoras opcionales de la interfaz: todo funciona igual sin este archivo.
document.documentElement.classList.add('js');

// Formularios que se envían solos al cambiar una casilla (verificación, DA-26): sin JavaScript tienen su botón.
for (const formulario of document.querySelectorAll('[data-enviar-al-cambiar]')) {
  formulario.addEventListener('change', () => formulario.requestSubmit());
  // Tras la recarga, el foco vuelve a la casilla para no perder el sitio con teclado o lector de pantalla.
  if (formulario.id && location.hash === `#${formulario.id}`) formulario.querySelector('input')?.focus();
}

// Lista de documentos por tipo: cada fila recibe el archivo que se suelta sobre ella.
for (const lista of document.querySelectorAll('[data-soltar-archivos]')) {
  const filaDe = (evento) => evento.target.closest?.('.fila');
  const traeArchivos = (evento) => [...(evento.dataTransfer?.types ?? [])].includes('Files');
  const marcar = (fila) => fila.classList.toggle('lleno', fila.querySelector('input[type=file]').files.length > 0);
  const quitarResalte = () => lista.querySelectorAll('.sobre').forEach((fila) => fila.classList.remove('sobre'));

  lista.addEventListener('change', (evento) => {
    const fila = filaDe(evento);
    if (fila) marcar(fila);
  });

  lista.addEventListener('dragover', (evento) => {
    if (!traeArchivos(evento)) return;
    evento.preventDefault(); // sin esto el navegador abriría el archivo
    const fila = filaDe(evento);
    if (fila?.classList.contains('sobre')) return;
    quitarResalte();
    fila?.classList.add('sobre');
  });

  lista.addEventListener('dragleave', (evento) => {
    if (!lista.contains(evento.relatedTarget)) quitarResalte();
  });

  lista.addEventListener('drop', (evento) => {
    if (!traeArchivos(evento)) return;
    evento.preventDefault();
    quitarResalte();
    const fila = filaDe(evento);
    const archivo = evento.dataTransfer.files[0];
    if (!fila || !archivo) return;
    const paquete = new DataTransfer(); // cada tipo lleva un solo archivo
    paquete.items.add(archivo);
    fila.querySelector('input[type=file]').files = paquete.files;
    marcar(fila);
  });
}

// Notificar faltantes (HU-07): el botón cuenta las casillas marcadas y se desactiva si no hay ninguna.
for (const boton of document.querySelectorAll('[data-contar-faltantes]')) {
  const formulario = boton.form;
  const contar = () => {
    const n = formulario.querySelectorAll('input[name=faltantes]:checked').length;
    boton.textContent = n === 1 ? 'Notificar 1 faltante' : `Notificar ${n} faltantes`;
    boton.disabled = n === 0;
  };
  formulario.addEventListener('change', contar);
}

// Formularios que no deben enviarse dos veces (un correo, o un pago que se sumaría dos veces, DA-08):
// tras el primer envío el botón se bloquea.
// Solo el botón que envía (no «Añadir», que recarga la página por GET).
for (const formulario of document.querySelectorAll('form[data-un-envio]')) {
  formulario.addEventListener('submit', (evento) => {
    const boton = evento.submitter;
    if (!boton?.dataset.enviando) return;
    boton.dataset.texto = boton.textContent;
    boton.textContent = boton.dataset.enviando;
    boton.setAttribute('aria-disabled', 'true');
    // Se desactivan todos los botones que envían (también el oculto de la tecla Enter, HU-25), después de que el
    // navegador tome los datos del envío: si no, otro botón del mismo formulario enviaría lo mismo dos veces.
    const enviadores = formulario.querySelectorAll('[data-enviando]');
    setTimeout(() => { for (const otro of enviadores) otro.disabled = true; });
  });
}

// Al volver atrás, el navegador puede restaurar la página desde su caché con el botón aún en «Enviando…».
window.addEventListener('pageshow', (evento) => {
  if (!evento.persisted) return;
  for (const boton of document.querySelectorAll('form[data-un-envio] [data-enviando]')) {
    boton.disabled = false;
    boton.removeAttribute('aria-disabled');
    if (boton.dataset.texto) boton.textContent = boton.dataset.texto;
    boton.closest('form').dispatchEvent(new Event('change')); // el contador rehace el texto y el estado
  }
});

// Registrar cobrada (HU-13): los atajos llenan los días y se muestra la fecha prometida (hoy + días, DA-38).
for (const campo of document.querySelectorAll('input[data-hoy]')) {
  const formulario = campo.form;
  const salida = formulario.querySelector('[data-fecha-prometida]');
  const atajos = formulario.querySelectorAll('[data-tiempo-pago]');
  const [anio, mes, dia] = campo.dataset.hoy.split('-').map(Number);
  const formato = new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const pintar = () => {
    const texto = campo.value.trim();
    const dias = Number(texto);
    const valido = /^\d{1,3}$/.test(texto) && dias >= 1 && dias <= 365;
    salida.classList.toggle('vacia', !valido);
    salida.querySelector('b').textContent = valido
      ? formato.format(new Date(Date.UTC(anio, mes - 1, dia + dias))).replace(',', '')
      : texto ? 'Entre 1 y 365 días' : 'Escriba los días';
    for (const boton of atajos) boton.setAttribute('aria-pressed', String(boton.dataset.tiempoPago === texto));
  };
  for (const boton of atajos) {
    boton.addEventListener('click', () => {
      campo.value = boton.dataset.tiempoPago;
      pintar();
      campo.focus();
    });
  }
  campo.addEventListener('input', pintar);
  salida.hidden = false;
  pintar();
}

// Respuesta de la entidad (HU-13/HU-14, DA-39): el segmento cambia el formulario sin recargar. Sin JavaScript,
// cada opción es un enlace (?respuesta=rechazo) y el servidor muestra el formulario que corresponde.
for (const segmento of document.querySelectorAll('.segmento')) {
  const paso = segmento.closest('.paso');
  for (const enlace of segmento.querySelectorAll('a[data-respuesta]')) {
    enlace.addEventListener('click', (evento) => {
      if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey || evento.button !== 0) return;
      evento.preventDefault();
      const respuesta = enlace.dataset.respuesta;
      for (const otro of segmento.querySelectorAll('a[data-respuesta]')) {
        if (otro === enlace) otro.setAttribute('aria-current', 'true');
        else otro.removeAttribute('aria-current');
      }
      for (const panel of paso.querySelectorAll('[data-panel-respuesta]')) {
        panel.hidden = panel.dataset.panelRespuesta !== respuesta;
        if (!panel.hidden) panel.classList.add('entra');
      }
      history.replaceState(null, '', enlace.href);
      if (respuesta === 'rechazo') paso.querySelector('[data-panel-respuesta="rechazo"] textarea')?.focus();
    });
  }
}

// Causal del rechazo (HU-14): contador en vivo. Cuenta como el maxlength del navegador (unidades UTF-16),
// para que el contador y el tope coincidan.
for (const contador of document.querySelectorAll('[data-contador]')) {
  const campo = contador.closest('.campo').querySelector('textarea');
  const maximo = Number(campo.maxLength);
  const pintar = () => { contador.textContent = `${campo.value.length} / ${maximo}`; };
  campo.addEventListener('input', pintar);
  contador.hidden = false;
  pintar();
}

// Valor del pago (HU-15, DA-40): al salir del campo se escriben los puntos de miles (1250000 → 1.250.000).
// Solo si lo escrito es un número que el servidor también acepta; si no, se deja como está y el servidor lo explica.
for (const campo of document.querySelectorAll('input[data-pesos]')) {
  campo.addEventListener('blur', () => {
    const limpio = campo.value.replace(/[\s $]/g, '');
    const sinMiles = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(limpio) ? limpio.replace(/\./g, '') : limpio;
    const partes = /^(\d{1,12})(,\d{1,2})?$/.exec(sinMiles);
    if (!partes) return;
    const enteros = partes[1].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    campo.value = enteros + (partes[2] ?? '');
  });
}
