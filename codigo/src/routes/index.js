// Índice de rutas: compone los 14 archivos <grupo>.routes.js (se agregan módulo por módulo).
import { Router } from 'express';

// eslint-disable-next-line no-unused-vars
export function crearRutas(dependencias = {}) {
  const rutas = Router();

  // Comprobación de que el servidor responde.
  rutas.get('/salud', (req, res) => res.json({ estado: 'ok' }));

  rutas.get('/', (req, res) => res.pagina('inicio', { titulo: 'Inicio' }));

  return rutas;
}
