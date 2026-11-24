// Acceso rápido en el inicio de sesión: un botón por actor con su usuario de demostración (DA-02).
// Está activo siempre que DEMO_PASSWORD esté definida (proyecto académico: se muestra en cualquier entorno).
// La contraseña nunca se envía al navegador.
import { ROLES } from '../models/usuario.model.js';

/** @returns {{ contrasena: string, correos: Record<string, string> } | null} */
export function configurarAccesoRapido(entorno = process.env) {
  if (!entorno.DEMO_PASSWORD) return null;
  return {
    contrasena: entorno.DEMO_PASSWORD,
    // Mismos usuarios que crea `npm run db:usuarios`: el primero de cada rol. El auxiliar va primero: es el actor
    // que más operaciones tiene.
    correos: Object.fromEntries(
      ['auxiliar', ...ROLES.filter((rol) => rol !== 'auxiliar')].map((rol) => [rol, `${rol}1@sigi.test`]),
    ),
  };
}
