// Grupo `reconocimiento` del Control de incapacidades — DS-09 (CU-13).
// Operaciones: consultarReconocimientos y prepararReconocimiento (apoyo de la Vista) y
// calcularReconocimiento(ibc) → guardarCalculo (HU-21).
import { aCentavos, centavosATexto, pesos } from '../servicios/moneda.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { leerValor } from './cobro.controller.js';
import { esIdentificador } from './identificador.js';

// DA-09: tramos del procedimiento. IBC diario = IBC ÷ 30; el mismo cálculo sirve para ARL y licencias
// (suposición marcada, pendiente de validar con el cliente).
export const DIAS_DEL_MES = 30;
export const TRAMOS = Object.freeze([
  { clave: 'empresa', nombre: 'Días 1 y 2', desde: 1, hasta: 2, porcentaje: 100, aCargo: 'empresa' },
  { clave: 'eps_1', nombre: 'Días 3 a 90', desde: 3, hasta: 90, porcentaje: 67, aCargo: 'eps' },
  { clave: 'eps_2', nombre: 'Días 91 a 180', desde: 91, hasta: 180, porcentaje: 50, aCargo: 'eps' },
]);
// HU-21: desde el día 181 el sistema marca el trámite de pensión (DA-10).
export const DIA_TRAMITE_PENSION = 181;
export const LISTA_MAXIMA = 200;
// numeric(14,2) guarda hasta 12 cifras enteras y la EPS llega a ~3,5 veces el IBC: con este tope ningún valor desborda.
export const IBC_MAXIMO = 10_000_000_000;

/**
 * Aplica los tramos a una incapacidad de `dias` días con un IBC en centavos enteros (DA-09). Cada tramo se redondea
 * al centavo; el valor de la EPS es la suma de sus tramos ya redondeados, así el detalle siempre suma el total.
 * @returns {{ tramos: object[], valorEmpresa: number, valorEPS: number, tramitePension: boolean, diasPension: number }} en centavos.
 */
export function calcularTramos(dias, ibcCentavos) {
  const tramos = TRAMOS.map((t) => {
    const diasDelTramo = Math.max(0, Math.min(dias, t.hasta) - t.desde + 1);
    const valor = Math.round((ibcCentavos * diasDelTramo * t.porcentaje) / (DIAS_DEL_MES * 100));
    return { ...t, dias: diasDelTramo, valor };
  });
  const suma = (aCargo) => tramos.filter((t) => t.aCargo === aCargo).reduce((total, t) => total + t.valor, 0);
  return {
    tramos,
    valorEmpresa: suma('empresa'),
    valorEPS: suma('eps'),
    tramitePension: dias >= DIA_TRAMITE_PENSION,
    diasPension: Math.max(0, dias - DIA_TRAMITE_PENSION + 1),
  };
}

/** Valida el IBC en pesos (mismo formato colombiano del pago, DA-40). @returns {{ valor?: string, centavos?: number, error?: string }} */
export function leerIbc(texto) {
  if (typeof texto !== 'string' || texto.replace(/[\s $]/g, '') === '') return { error: 'Escriba el IBC de la incapacidad.' };
  const valor = leerValor(texto);
  if (valor.centavos > IBC_MAXIMO * 100) return { error: `El IBC no puede superar ${pesos(IBC_MAXIMO)}.` };
  return valor;
}

const aResultado = (dias, ibc) => ({ ibc, dias, ...calcularTramos(dias, aCentavos(ibc)) });

export function crearControlReconocimiento({ baseDeDatos }) {
  return {
    /** Apoyo de la Vista: las incapacidades más recientes con su cálculo, si lo tienen. Solo consulta. */
    async consultarReconocimientos() {
      const { total, filas } = await baseDeDatos.consultarParaReconocimiento(LISTA_MAXIMA);
      return { total, filas, limite: LISTA_MAXIMA };
    },

    /** Datos de la pantalla de cálculo: la incapacidad y, si ya se calculó, el resultado. null si no existe. */
    async prepararReconocimiento(idIncapacidad) {
      const incapacidad = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosReconocimiento(Number(idIncapacidad)) : null;
      if (!incapacidad) return null;
      return {
        incapacidad,
        resultado: incapacidad.ibc == null ? null : aResultado(incapacidad.diasIncapacidad, incapacidad.ibc),
        tramos: TRAMOS,
      };
    },

    /**
     * DS-09: calcularReconocimiento(ibc) → guardarCalculo(ibc, valorEmpresa, valorEPS, tramitePension) — HU-21.
     * El auxiliar ingresa el IBC al calcular; el sistema aplica los tramos a los días registrados (DA-09), marca el
     * trámite de pensión desde el día 181 (DA-10) y guarda el resultado. Calcular otra vez lo reemplaza.
     * @param {{ ibc?: string }} datos
     * @param {{ id: string }} usuario quien calcula (DA-23).
     * @returns {Promise<null | object>} null si la incapacidad no existe.
     * @throws {ErrorDeValidacion} IBC no válido (`ibc`).
     */
    async calcularReconocimiento(idIncapacidad, datos, usuario) {
      const incapacidad = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosReconocimiento(Number(idIncapacidad)) : null;
      if (!incapacidad) return null;
      const ibc = leerIbc(datos?.ibc);
      if (ibc.error) throw new ErrorDeValidacion({ ibc: ibc.error });

      const resultado = aResultado(incapacidad.diasIncapacidad, ibc.valor);
      await baseDeDatos.guardarCalculo(incapacidad.idIncapacidad, {
        ibc: ibc.valor,
        valorEmpresa: centavosATexto(resultado.valorEmpresa),
        valorEPS: centavosATexto(resultado.valorEPS),
        tramitePension: resultado.tramitePension,
      }, usuario.id);
      return { idIncapacidad: incapacidad.idIncapacidad, ...resultado };
    },
  };
}
