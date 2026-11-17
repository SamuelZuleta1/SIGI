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
