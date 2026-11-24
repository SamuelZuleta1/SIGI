// Grupo `alertas` de la Interfaz de incapacidades — DS-14 (CU-09).
// Operación de la Vista: consultarAlertas → obtenerAlertas → listaAlertas → mostrarAlertas (HU-12). Solo lectura (GET).
import { Router } from 'express';
import { NOMBRES_PLAZO, TIPOS_PLAZO } from '../controllers/alertas.controller.js';
import { permitir } from '../middleware/autenticacion.js';
import { fechaBreve, fechaLarga } from '../servicios/dias-habiles.js';

/** Dónde se actúa sobre cada alerta: la subsanación y el envío en la verificación; los demás en la radicación. */
export const enlaceAlerta = ({ tipo, idIncapacidad }) =>
  `/incapacidades/${idIncapacidad}/${tipo === 'subsanacion' || tipo === 'envio' ? 'verificacion' : 'radicacion'}`;

export function crearRutasAlertas({ control }) {
  const rutas = Router();

  // consultarAlertas → listaAlertas(porVencer, vencidas) → mostrarAlertas (HU-12.CA1). Filtro opcional ?tipo=.
  rutas.get('/alertas', permitir('consultarAlertas'), async (req, res) => {
    const datos = await control.obtenerAlertas(req.query);
    res.pagina('alertas/consultar-alertas', {
      titulo: 'Alertas de plazos',
      ...datos,
      tiposPlazo: TIPOS_PLAZO,
      nombresPlazo: NOMBRES_PLAZO,
      enlaceAlerta,
      fechaBreve,
      fechaLarga,
    });
  });

  return rutas;
}
