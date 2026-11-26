// Grupo `subidas` del Control de incapacidades: archivos grandes que el navegador sube directo al bucket privado
// (Vercel no admite más de 4,5 MB por petición). El servidor no confía en ellos: al registrar, los descarga y los valida
// igual que un archivo recibido por el formulario (tamaño y tipo por contenido).

/** Solo se aceptan rutas que el propio servidor reservó para ese usuario. */
const rutaDe = (idUsuario) => new RegExp(`^pendientes/${idUsuario}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`);

export function crearControlSubidas({ baseDeDatos }) {
  return {
    /** Reserva dónde sube el navegador su archivo: { ruta, urlFirmada }. */
    async prepararSubida(usuario) {
      return baseDeDatos.prepararSubida(usuario.id);
    },

    /** Contenido de una subida del usuario, o null si la ruta no es suya o el archivo no llegó. */
    async leerSubida(ruta, usuario) {
      if (typeof ruta !== 'string' || !rutaDe(usuario.id).test(ruta)) return null;
      return baseDeDatos.descargarSubida(ruta);
    },

    /** Borra las subidas del usuario (ignora rutas que no son suyas). */
    async descartarSubidas(rutas, usuario) {
      const propias = rutas.filter((ruta) => typeof ruta === 'string' && rutaDe(usuario.id).test(ruta));
      if (propias.length > 0) await baseDeDatos.eliminarSubidas(propias);
    },
  };
}
