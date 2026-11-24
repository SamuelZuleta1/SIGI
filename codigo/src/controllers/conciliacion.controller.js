// Grupo `conciliacion` del Control de incapacidades — DS-11 (CU-15).
// Operación: registrarPagosConsignados(listaPagos) → guardarPagosConsignados → notificarPagosPorIdentificar (HU-25).
// Apoyo de la Vista: prepararPagosConsignados (entidades del formulario y los pagos registrados más recientes).
// Operación: identificarPagos(entidad, detallePagos) → obtenerPagosConsignados → compararPagos →
// guardarConciliacion + enviarDetalleConciliado | guardarSaldosPendientes + notificarSaldosPendientes (HU-26, DA-11,
// DA-56). Apoyo de la Vista: prepararConciliacion y consultarConciliacion.
import { leerValor } from './cobro.controller.js';
import { avisarODeshacer } from './error-de-aviso.js';
import { normalizarTexto } from './estados.controller.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { aCentavos, centavosATexto } from '../servicios/moneda.js';

// DA-55: una lista es de una sola entidad (el aviso al auxiliar es por entidad, como el bucle de DS-11).
export const FILAS_INICIALES = 5;
export const FILAS_POR_AGREGAR = 5;
export const FILAS_MAXIMAS = 100;
export const RECIENTES = 50;
export const COLABORADOR_MINIMO = 3;
export const COLABORADOR_MAXIMO = 200;
// Tope técnico, como los días de incapacidad del registro (cabe en un entero de la base de datos).
export const DIAS_MAXIMOS = 9999;

const MENSAJES_VALOR = Object.freeze({
  vacio: 'Escriba el valor consignado.',
  formato: 'Escriba el valor en pesos, por ejemplo 1.250.000 o 1.250.000,50.',
  grande: 'El valor es demasiado grande.',
  cero: 'El valor debe ser mayor que cero.',
});

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Un campo repetido del formulario llega como texto (una fila) o como lista (varias). */
const comoLista = (valor) => (Array.isArray(valor) ? valor : valor == null ? [] : [valor]).map((v) => (typeof v === 'string' ? v : ''));

/**
 * Las filas tal como las escribió Contabilidad, alineadas por posición y con un máximo de FILAS_MAXIMAS.
 * @returns {{ colaborador: string, dias: string, valor: string }[]}
 */
/** Cuántas filas llegaron, sin el tope de FILAS_MAXIMAS. */
const filasRecibidas = (datos) =>
  Math.max(comoLista(datos?.colaborador).length, comoLista(datos?.dias).length, comoLista(datos?.valor).length);

export function leerFilas(datos) {
  const colaboradores = comoLista(datos?.colaborador);
  const dias = comoLista(datos?.dias);
  const valores = comoLista(datos?.valor);
  const cantidad = Math.min(FILAS_MAXIMAS, filasRecibidas(datos));
  return Array.from({ length: cantidad }, (_, i) => ({
    colaborador: (colaboradores[i] ?? '').slice(0, COLABORADOR_MAXIMO + 50),
    dias: (dias[i] ?? '').slice(0, 20),
    valor: (valores[i] ?? '').slice(0, 30),
  }));
}

const filaVacia = (f) => f.colaborador.trim() === '' && f.dias.trim() === '' && f.valor.trim() === '';

function leerColaborador(texto) {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (limpio === '') return { error: 'Escriba el nombre del colaborador.' };
  if (CONTROL.test(texto.replace(/[\t\n\r]/g, ' '))) return { error: 'El nombre tiene caracteres no válidos.' };
  if (limpio.length < COLABORADOR_MINIMO) return { error: `Escriba el nombre completo (${COLABORADOR_MINIMO} caracteres o más).` };
  if (limpio.length > COLABORADOR_MAXIMO) return { error: 'El nombre es demasiado largo.' };
  return { valor: limpio };
}

function leerDias(texto) {
  const limpio = texto.trim();
  if (limpio === '') return { error: 'Escriba los días pagados.' };
  if (!/^\d{1,4}$/.test(limpio)) return { error: 'Escriba un número entero de días.' };
  const dias = Number(limpio);
  if (dias < 1 || dias > DIAS_MAXIMOS) return { error: 'Los días pagados deben ser 1 o más.' };
  return { valor: dias };
}

/**
 * Valida la lista (HU-25): entidad de la lista de EPS y ARL, y en cada fila con algo escrito el colaborador, los días
 * pagados y el valor (pesos con el formato del pago, DA-40). Las filas vacías se ignoran; debe quedar al menos una.
 * @returns {{ entidad?: object, pagos?: object[], errores: object }} errores por campo: `entidad`, `lista`, `fila-N-campo`.
 */
export function validarLista(datos, entidades) {
  const errores = {};
  const entidad = entidades.find((e) => String(e.id) === String(datos?.entidad ?? '').trim());
  if (!entidad) errores.entidad = 'Elija la entidad que consignó.';

  const filas = leerFilas(datos);
  const pagos = [];
  filas.forEach((f, i) => {
    if (filaVacia(f)) return;
    const colaborador = leerColaborador(f.colaborador);
    const dias = leerDias(f.dias);
    const valor = leerValor(f.valor, MENSAJES_VALOR);
    if (colaborador.error) errores[`fila-${i}-colaborador`] = colaborador.error;
    if (dias.error) errores[`fila-${i}-dias`] = dias.error;
    if (valor.error) errores[`fila-${i}-valor`] = valor.error;
    if (!colaborador.error && !dias.error && !valor.error) {
      pagos.push({ colaborador: colaborador.valor, diasPagados: dias.valor, valor: valor.valor, centavos: valor.centavos });
    }
  });
  // Más filas de las que muestra el formulario: no se guarda una parte en silencio.
  if (filasRecibidas(datos) > FILAS_MAXIMAS) errores.lista = `Registre como máximo ${FILAS_MAXIMAS} pagos por lista: divídala en varias.`;
  else if (filas.every(filaVacia)) errores.lista = 'Escriba al menos un pago: colaborador, días pagados y valor.';
  else if (Object.keys(errores).some((c) => c.startsWith('fila-'))) errores.lista = 'Revise las filas marcadas: no se guardó ningún pago.';
  return { entidad, pagos, errores };
}

// HU-26 (DA-56).
export const CONCILIACIONES_RECIENTES = 10;
export const PAGOS_ELEGIDOS_MAXIMOS = 500;

/**
 * compararPagos (DS-11, DA-11): un pago consignado queda identificado con un pago registrado de la misma entidad si
 * coinciden el colaborador (nombre sin tildes, mayúsculas ni espacios de más: P-B) y el valor exacto (en centavos).
 * Cada pago se usa una sola vez; los consignados se recorren del más antiguo al más reciente y toman el primer pago
 * libre que coincide (fecha de pago más antigua primero).
 * @param {{ id, colaborador, valor }[]} consignados
 * @param {{ idPago, colaborador, valor }[]} pagos los que eligió el auxiliar.
 * @returns {{ pares: { consignado, pago }[], consignadosSinIdentificar: object[], pagosSinConsignacion: object[] }}
 */
export function compararPagos(consignados, pagos) {
  const clave = (colaborador, valor) => `${normalizarTexto(colaborador)}|${aCentavos(valor)}`;
  const libres = new Map();
  for (const pago of pagos) {
    const k = clave(pago.colaborador, pago.valor);
    libres.set(k, [...(libres.get(k) ?? []), pago]);
  }
  const pares = [];
  const consignadosSinIdentificar = [];
  for (const consignado of consignados) {
    const pago = libres.get(clave(consignado.colaborador, consignado.valor))?.shift();
    if (pago) pares.push({ consignado, pago });
    else consignadosSinIdentificar.push(consignado);
  }
  return { pares, consignadosSinIdentificar, pagosSinConsignacion: [...libres.values()].flat() };
}

/** Los pagos que eligió el auxiliar: ids enteros positivos sin repetir. null si alguno no es válido. */
export function leerPagosElegidos(valor) {
  const lista = comoLista(valor);
  if (lista.length > PAGOS_ELEGIDOS_MAXIMOS) return null;
  const ids = [];
  for (const texto of lista) {
    if (!/^\d{1,15}$/.test(texto.trim())) return null;
    const id = Number(texto.trim());
    if (id < 1) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

// En el detalle y los saldos (jsonb) el valor va como texto «1234567.50»: exacto al centavo, como numeric(14,2).
const comoTexto = (valor) => centavosATexto(aCentavos(valor));

const total = (filas) => filas.reduce((s, f) => s + aCentavos(f.valor), 0);

export function crearControlConciliacion({ baseDeDatos, correo }) {
  return {
    /**
     * Apoyo de la Vista: entidades (EPS y ARL) y los pagos registrados más recientes. Solo consulta.
     * @param {{ entidad?: string, cantidad?: string }} [confirmar] lo que dice el enlace tras registrar. La confirmación
     *   solo se muestra si los pagos más recientes son de verdad esa cantidad de esa entidad.
     */
    async prepararPagosConsignados(confirmar = {}) {
      const [entidades, recientes] = await Promise.all([
        baseDeDatos.consultarEntidades(),
        baseDeDatos.consultarPagosConsignados(RECIENTES),
      ]);
      let confirmacion = null;
      const cantidad = Number(confirmar.cantidad);
      if (Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= Math.min(FILAS_MAXIMAS, recientes.length)) {
        const lote = recientes.slice(0, cantidad);
        const entidad = entidades.find((e) => String(e.id) === String(confirmar.entidad));
        if (entidad && lote.every((p) => p.entidadId === entidad.id)) {
          confirmacion = { entidad: entidad.nombre, cantidad, total: lote.reduce((s, p) => s + aCentavos(p.valor), 0) };
        }
      }
      return { entidades, recientes, confirmacion };
    },

    /**
     * DS-11: registrarPagosConsignados(listaPagos) → guardarPagosConsignados(listaPagos) → notificarPagosPorIdentificar
     * — HU-25. Guarda toda la lista de una vez (DA-23: quién la registró) y después avisa al auxiliar que hay pagos por
     * identificar. Si el correo falla, borra la lista y se puede reintentar (mismo orden que DA-44 y DA-47).
     * @param {{ entidad?: string, colaborador?: string|string[], dias?: string|string[], valor?: string|string[] }} datos
     * @param {{ id: string }} usuario
     * @returns {Promise<{ entidad: object, cantidad: number, total: number }>} total en centavos.
     * @throws {ErrorDeValidacion} | {ErrorDeAviso}
     */
    async registrarPagosConsignados(datos, usuario) {
      const entidades = await baseDeDatos.consultarEntidades();
      const { entidad, pagos, errores } = validarLista(datos, entidades);
      if (Object.keys(errores).length > 0) throw new ErrorDeValidacion(errores);

      const ids = await baseDeDatos.guardarPagosConsignados(
        entidad.id,
        pagos.map(({ colaborador, diasPagados, valor }) => ({ colaborador, diasPagados, valor })),
        usuario.id,
      );
      await avisarODeshacer({
        operacion: 'pagos por identificar',
        asunto: `${pagos.length} pago(s) consignado(s) de ${entidad.nombre}`,
        avisar: () => correo.notificarPagosPorIdentificar(entidad.nombre, pagos.length),
        deshacer: () => baseDeDatos.eliminarPagosConsignados(ids),
      });
      return { entidad, cantidad: pagos.length, total: pagos.reduce((s, p) => s + p.centavos, 0) };
    },

    /**
     * Apoyo de la Vista (HU-26): entidades con cuántos pagos consignados tienen por identificar, las conciliaciones
     * recientes y, si se eligió una entidad, sus pagos consignados por identificar y los pagos registrados por
     * conciliar (el auxiliar elige entre estos: DA-11). Solo consulta.
     * @param {string} [entidadElegida] id de la entidad, como llega en el enlace.
     */
    async prepararConciliacion(entidadElegida) {
      const [entidades, porIdentificar, recientes] = await Promise.all([
        baseDeDatos.consultarEntidades(),
        baseDeDatos.contarPorIdentificar(),
        baseDeDatos.consultarConciliaciones(CONCILIACIONES_RECIENTES),
      ]);
      const entidad = entidades.find((e) => String(e.id) === String(entidadElegida ?? '').trim()) ?? null;
      const datos = { entidades: entidades.map((e) => ({ ...e, porIdentificar: porIdentificar[e.id] ?? 0 })), recientes, entidad };
      if (!entidad) return { ...datos, consignados: [], pagos: [], totalConsignado: 0, coincidencias: { consignados: [], pagos: [] } };
      const [consignados, pagos] = await Promise.all([
        baseDeDatos.obtenerPagosConsignados(entidad.id),
        baseDeDatos.consultarPagosPorConciliar(entidad.id),
      ]);
      // Vista previa de compararPagos con todos los pagos elegidos: la pantalla marca los que coinciden.
      const { pares } = compararPagos(consignados, pagos);
      return {
        ...datos,
        consignados,
        pagos,
        totalConsignado: total(consignados),
        coincidencias: { consignados: pares.map((p) => p.consignado.id), pagos: pares.map((p) => p.pago.idPago) },
      };
    },

    /** Apoyo de la Vista: una conciliación guardada (su detalle y sus saldos); null si no existe. */
    async consultarConciliacion(id) {
      return baseDeDatos.consultarConciliacion(id);
    },

    /**
     * DS-11: identificarPagos(entidad, detallePagos) — HU-26. `detallePagos` son los pagos registrados de la entidad
     * que eligió el auxiliar (DA-11). Obtiene los pagos consignados por identificar de la entidad, los compara
     * (compararPagos) y:
     *  - si todos quedan identificados (y no sobra ningún pago elegido), guarda la conciliación, marca los pagos como
     *    conciliados y envía el detalle conciliado a Contabilidad y Tesorería (CA2);
     *  - si quedan saldos, guarda los saldos pendientes junto con lo identificado (también conciliado) y los notifica a
     *    Contabilidad y Tesorería (CA3). Los consignados sin identificar siguen pendientes para otra conciliación.
     * Si el correo falla, se deshace todo y se puede reintentar (DA-44/DA-47).
     * @param {{ entidad?: string, pagos?: string|string[] }} datos
     * @param {{ id: string }} usuario
     * @returns {Promise<{ idConciliacion: number, entidad: object, conciliada: boolean }>}
     * @throws {ErrorDeValidacion} errores `entidad`, `pagos` o `cambio` (otra persona concilió: 409) | {ErrorDeAviso}
     */
    async identificarPagos(datos, usuario) {
      const entidades = await baseDeDatos.consultarEntidades();
      const entidad = entidades.find((e) => String(e.id) === String(datos?.entidad ?? '').trim());
      if (!entidad) throw new ErrorDeValidacion({ entidad: 'Elija la entidad que va a conciliar.' });
      const elegidos = leerPagosElegidos(datos?.pagos);
      if (!elegidos) throw new ErrorDeValidacion({ pagos: 'La selección de pagos no es válida. Vuelva a elegirlos.' });

      const [consignados, candidatos] = await Promise.all([
        baseDeDatos.obtenerPagosConsignados(entidad.id),
        baseDeDatos.consultarPagosPorConciliar(entidad.id),
      ]);
      if (consignados.length === 0) {
        throw new ErrorDeValidacion({ entidad: `${entidad.nombre} no tiene pagos consignados por identificar.` });
      }
      if (elegidos.some((id) => !candidatos.some((p) => p.idPago === id))) {
        throw new ErrorDeValidacion({ cambio: 'Uno de los pagos elegidos ya se concilió o no es de esta entidad. Revise la lista.' });
      }
      // En el orden de la pantalla (fecha de pago), no en el que llegaron: el resultado no depende del navegador.
      const pagos = candidatos.filter((p) => elegidos.includes(p.idPago));

      const { pares, consignadosSinIdentificar, pagosSinConsignacion } = compararPagos(consignados, pagos);
      const detalle = pares.map(({ consignado, pago }) => ({
        colaborador: consignado.colaborador,
        diasPagados: consignado.diasPagados,
        valor: comoTexto(consignado.valor),
        idPagoConsignado: consignado.id,
        idPago: pago.idPago,
        idIncapacidad: pago.idIncapacidad,
        fechaPago: pago.fechaPago,
      }));
      const saldos = [
        ...consignadosSinIdentificar.map((c) => ({
          tipo: 'consignado', colaborador: c.colaborador, diasPagados: c.diasPagados, valor: comoTexto(c.valor), idPagoConsignado: c.id,
        })),
        ...pagosSinConsignacion.map((p) => ({
          tipo: 'pago', colaborador: p.colaborador, valor: comoTexto(p.valor), idPago: p.idPago, idIncapacidad: p.idIncapacidad, fechaPago: p.fechaPago,
        })),
      ];
      const conciliada = saldos.length === 0;
      const registro = {
        consignadosVistos: consignados.map((c) => c.id),
        pares: pares.map(({ consignado, pago }) => ({ consignado: consignado.id, pago: pago.idPago })),
        detalle,
        saldos,
      };
      const idConciliacion = conciliada
        ? await baseDeDatos.guardarConciliacion(entidad.id, registro, usuario.id)
        : await baseDeDatos.guardarSaldosPendientes(entidad.id, registro, usuario.id);
      if (idConciliacion == null) {
        throw new ErrorDeValidacion({ cambio: 'Los pagos de esta entidad cambiaron mientras los revisaba. Revise la lista y vuelva a conciliar.' });
      }

      await avisarODeshacer({
        operacion: conciliada ? 'detalle conciliado' : 'saldos pendientes',
        asunto: `conciliación n.º ${idConciliacion} de ${entidad.nombre}`,
        avisar: () =>
          conciliada
            ? correo.enviarDetalleConciliado(entidad.nombre, detalle)
            : correo.notificarSaldosPendientes(entidad.nombre, saldos, detalle.length),
        deshacer: () => baseDeDatos.deshacerConciliacion(idConciliacion),
      });
      return { idConciliacion, entidad, conciliada };
    },
  };
}
