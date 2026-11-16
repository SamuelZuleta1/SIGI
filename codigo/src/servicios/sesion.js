// Sesión con Supabase Auth (HU-01). Lo usa middleware/autenticacion.js.
// Se inyecta en la aplicación para poder reemplazarlo por uno falso en las pruebas.
import { crearClientePublico, crearClienteServidor } from '../config/supabase.js';

const aSesion = (session) => ({ acceso: session.access_token, renovacion: session.refresh_token });

export function crearServicioSesion({ servidor = crearClienteServidor(), nuevoClientePublico = crearClientePublico } = {}) {
  return {
    /** Devuelve { acceso, renovacion } o null si las credenciales no son válidas. */
    async iniciarSesion(correo, contrasena) {
      // Cliente nuevo en cada llamada: signIn guarda la sesión en memoria del cliente
      // y no debe compartirse entre usuarios.
      const { data, error } = await nuevoClientePublico().auth.signInWithPassword({ email: correo, password: contrasena });
      return error || !data.session ? null : aSesion(data.session);
    },

    /** Valida el token contra Supabase Auth. Devuelve el id del usuario o null. */
    async verificar(acceso) {
      const { data, error } = await servidor.auth.getUser(acceso);
      return error || !data.user ? null : data.user.id;
    },

    /** Cambia el token de renovación por una sesión nueva, o null si ya no sirve. */
    async renovar(renovacion) {
      const { data, error } = await nuevoClientePublico().auth.refreshSession({ refresh_token: renovacion });
      return error || !data.session ? null : { ...aSesion(data.session), idUsuario: data.session.user.id };
    },

    /** Usuario con su rol (tabla `usuario`, DA-02). null si la cuenta no tiene rol. */
    async obtenerUsuario(id) {
      const { data, error } = await servidor.from('usuario').select('id, correo, rol').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },

    /** Invalida la sesión en Supabase Auth. */
    async cerrarSesion(acceso) {
      await servidor.auth.admin.signOut(acceso);
    },
  };
}
