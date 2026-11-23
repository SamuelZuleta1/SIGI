// Grupo `conciliacion` del Control de incapacidades — DS-11 (CU-15).
// Operación: registrarPagosConsignados(listaPagos) → guardarPagosConsignados → notificarPagosPorIdentificar (HU-25).
// Apoyo de la Vista: prepararPagosConsignados (entidades del formulario y los pagos registrados más recientes).
// identificarPagos (HU-26) llega en T-26.
import { leerValor } from './cobro.controller.js';
import { avisarODeshacer } from './error-de-aviso.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { aCentavos } from '../servicios/moneda.js';

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
export function leerFilas(datos) {
  const colaboradores = comoLista(datos?.colaborador);
  const dias = comoLista(datos?.dias);
  const valores = comoLista(datos?.valor);
  const cantidad = Math.min(FILAS_MAXIMAS, Math.max(colaboradores.length, dias.length, valores.length));
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
  if (filas.every(filaVacia)) errores.lista = 'Escriba al menos un pago: colaborador, días pagados y valor.';
  else if (Object.keys(errores).some((c) => c.startsWith('fila-'))) errores.lista = 'Revise las filas marcadas: no se guardó ningún pago.';
  return { entidad, pagos, errores };
}

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
  };
}
