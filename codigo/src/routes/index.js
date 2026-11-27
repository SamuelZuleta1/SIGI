// Índice de rutas: compone los 14 archivos <grupo>.routes.js (se agregan módulo por módulo).
import { Router } from 'express';
import { exigirSesion } from '../middleware/autenticacion.js';
import { PAGINA_DE_ENTRADA } from '../config/permisos.js';
import { crearRutasAlertas } from './alertas.routes.js';
import { crearRutasArchivo } from './archivo.routes.js';
import { crearRutasCobro } from './cobro.routes.js';
import { crearRutasCobroJuridico } from './cobro-juridico.routes.js';
import { crearRutasConciliacion } from './conciliacion.routes.js';
import { crearRutasEstadisticas } from './estadisticas.routes.js';
import { crearRutasEstados } from './estados.routes.js';
import { crearRutasMonitoreo } from './monitoreo.routes.js';
import { crearRutasRadicacion } from './radicacion.routes.js';
import { crearRutasReconocimiento } from './reconocimiento.routes.js';
import { crearRutasReemplazo } from './reemplazo.routes.js';
import { crearRutasRegistro } from './registro.routes.js';
import { crearRutasReportes } from './reportes.routes.js';
import { crearRutasSeguimiento } from './seguimiento.routes.js';
import { crearRutasSesion } from './sesion.routes.js';
import { crearRutasSubidas } from './subidas.js';
import { crearRutasVerificacion } from './verificacion.routes.js';

export function crearRutas(dependencias) {
  const rutas = Router();

  // Públicas: comprobación del servidor e inicio de sesión.
  rutas.get('/salud', (req, res) => res.json({ estado: 'ok' }));
  rutas.use(crearRutasSesion(dependencias));

  // Desde aquí, todo exige una sesión válida (HU-01).
  rutas.use(exigirSesion);

  // No hay página de inicio: cada rol entra directo a su primera pantalla.
  rutas.get('/', (req, res) => res.redirect(PAGINA_DE_ENTRADA[req.usuario.rol] ?? '/iniciar-sesion'));

  // Grupos de operaciones (necesitan el Control de incapacidades).
  if (dependencias.control) {
    rutas.use(crearRutasSubidas(dependencias));
    rutas.use(crearRutasRegistro(dependencias));
    rutas.use(crearRutasReemplazo(dependencias));
    rutas.use(crearRutasVerificacion(dependencias));
    rutas.use(crearRutasRadicacion(dependencias));
    rutas.use(crearRutasEstados(dependencias));
    rutas.use(crearRutasAlertas(dependencias));
    rutas.use(crearRutasCobro(dependencias));
    rutas.use(crearRutasSeguimiento(dependencias));
    rutas.use(crearRutasCobroJuridico(dependencias));
    rutas.use(crearRutasReconocimiento(dependencias));
    rutas.use(crearRutasMonitoreo(dependencias));
    rutas.use(crearRutasConciliacion(dependencias));
    rutas.use(crearRutasReportes(dependencias));
    rutas.use(crearRutasEstadisticas(dependencias));
    rutas.use(crearRutasArchivo(dependencias));
  }

  // Solo para las pruebas: rutas de ensayo detrás de la sesión.
  if (dependencias.rutasAdicionales) rutas.use(dependencias.rutasAdicionales);

  return rutas;
}
