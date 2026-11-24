// Servicio de sesión falso para las pruebas HTTP: no usa Supabase.
import { ROLES } from '../../src/models/usuario.model.js';

export const CONTRASENA = 'Clave-de-prueba-1';

// Un usuario por rol: receptor@sigi.test, auxiliar@sigi.test…
export const USUARIOS = Object.fromEntries(
  ROLES.map((rol) => [rol, { id: `id-${rol}`, correo: `${rol}@sigi.test`, rol }]),
);

export function crearSesionFalsa() {
  const activas = new Map(); // token de acceso → id de usuario
  const renovables = new Map(); // token de renovación → id de usuario
  let contador = 0;
  const porId = (id) => Object.values(USUARIOS).find((u) => u.id === id) ?? null;

  const abrir = (id) => {
    contador += 1;
    const sesion = { acceso: `acceso-${contador}`, renovacion: `renovacion-${contador}` };
    activas.set(sesion.acceso, id);
    renovables.set(sesion.renovacion, id);
    return sesion;
  };

  return {
    cierres: [],
    async iniciarSesion(correo, contrasena) {
      const usuario = Object.values(USUARIOS).find((u) => u.correo === correo);
      return usuario && contrasena === CONTRASENA ? abrir(usuario.id) : null;
    },
    async verificar(acceso) { return activas.get(acceso) ?? null; },
    async renovar(renovacion) {
      const id = renovables.get(renovacion);
      if (!id) return null;
      renovables.delete(renovacion);
      return { ...abrir(id), idUsuario: id };
    },
    async obtenerUsuario(id) { return porId(id); },
    async cerrarSesion(acceso) { this.cierres.push(acceso); activas.delete(acceso); },
    // Solo para las pruebas:
    vencer(acceso) { activas.delete(acceso); },
    abrirSinRol() { return abrir('id-sin-rol'); },
  };
}

/** Agente de Supertest con la sesión de un rol ya iniciada. */
export async function agenteCon(request, app, rol) {
  const agente = request.agent(app);
  await agente.post('/iniciar-sesion').type('form').send({ correo: USUARIOS[rol].correo, contrasena: CONTRASENA });
  return agente;
}
