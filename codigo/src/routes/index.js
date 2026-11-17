// Índice de rutas: compone los 14 archivos <grupo>.routes.js (se agregan módulo por módulo).
import { Router } from 'express';
import { exigirSesion } from '../middleware/autenticacion.js';
import { NOMBRES_DE_ROL } from '../config/permisos.js';
import { crearRutasRegistro } from './registro.routes.js';
import { crearRutasSesion } from './sesion.routes.js';

export function crearRutas(dependencias) {
  const rutas = Router();

  // Públicas: comprobación del servidor e inicio de sesión.
  rutas.get('/salud', (req, res) => res.json({ estado: 'ok' }));
  rutas.use(crearRutasSesion(dependencias));

  // Desde aquí, todo exige una sesión válida (HU-01).
  rutas.use(exigirSesion);

  rutas.get('/', (req, res) =>
    res.pagina('inicio', { titulo: 'Inicio', nombreRol: NOMBRES_DE_ROL[req.usuario.rol] }),
  );

  // Grupos de operaciones (necesitan el Control de incapacidades).
  if (dependencias.control) {
    rutas.use(crearRutasRegistro(dependencias));
  }

  // Solo para las pruebas: rutas de ensayo detrás de la sesión.
  if (dependencias.rutasAdicionales) rutas.use(dependencias.rutasAdicionales);

  return rutas;
}
