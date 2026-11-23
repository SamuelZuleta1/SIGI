// Grupo `reconocimiento` del Control de incapacidades — DS-09 (CU-13).
// Operaciones: consultarReconocimientos y prepararReconocimiento (apoyo de la Vista) y
// calcularReconocimiento(ibc) → guardarCalculo (HU-21).
import { aCentavos, centavosATexto, pesos } from '../servicios/moneda.js';
import { advertenciaIbc } from '../servicios/smmlv.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { leerValor } from './cobro.controller.js';
import { esIdentificador } from './identificador.js';

// DA-09: tramos del procedimiento. IBC diario = IBC ÷ 30. A los demás tipos (ARL, licencias, tránsito) se les aplican
// los mismos tramos, con una advertencia visible: es una suposición por validar con el cliente (DA-51). Las prórrogas
// no se acumulan: cada certificado cuenta sus días desde 1 (DA-50, por validar).
export const DIAS_DEL_MES = 30;
export const TRAMOS = Object.freeze([
  { clave: 'empresa', nombre: 'Días 1 y 2', desde: 1, hasta: 2, porcentaje: 100, aCargo: 'empresa' },
  { clave: 'eps_1', nombre: 'Días 3 a 90', desde: 3, hasta: 90, porcentaje: 67, aCargo: 'eps' },
  { clave: 'eps_2', nombre: 'Días 91 a 180', desde: 91, hasta: 180, porcentaje: 50, aCargo: 'eps' },
]);
// HU-21: desde el día 181 el sistema marca el trámite de pensión (DA-10).
export const DIA_TRAMITE_PENSION = 181;
export const LISTA_MAXIMA = 200;
// Búsqueda de la lista (auditoría de T-21 a T-24, opción A): un solo campo, n.º de incapacidad o nombre del colaborador.
export const BUSQUEDA_MAXIMA = 60;

/**
 * Lee la búsqueda de la lista. Solo cifras = n.º exacto de la incapacidad; si no, parte del nombre del colaborador.
 * El asterisco se quita porque la API lo usa como comodín.
 * @returns {null | { texto: string, id?: number, nombre?: string }} null si no hay búsqueda.
 */
export function leerBusqueda(valor) {
  const texto = typeof valor === 'string' ? valor.replace(/\*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, BUSQUEDA_MAXIMA) : '';
  if (texto === '') return null;
  // Un número que no puede ser un id (cero, demasiado largo) no coincide con nada.
  if (/^\d+$/.test(texto)) return { texto, id: esIdentificador(texto) ? Number(texto) : 0 };
  return { texto, nombre: texto };
}
// numeric(14,2) guarda hasta 12 cifras enteras y la EPS llega a ~3,5 veces el IBC: con este tope ningún valor desborda.
export const IBC_MAXIMO = 10_000_000_000;
// DA-53: el reconocimiento se puede recalcular en cualquier estado menos «pagada».
// DA-51: los tramos de DA-09 son los del procedimiento para la enfermedad general.
export const TIPO_CON_REGLA = 'enfermedad_general';

export const MENSAJE_PAGADA = 'La incapacidad está pagada: su reconocimiento ya no se calcula ni se cambia.';

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

// Los mensajes de leerValor hablan del pago (HU-15); el IBC tiene los suyos.
const ERROR_FORMATO_IBC = 'Escriba el IBC en pesos, por ejemplo 2.800.000 o 2.800.000,50.';
const ERRORES_IBC = Object.freeze({
  'El valor debe ser mayor que cero.': 'El IBC debe ser mayor que cero.',
  'El valor es demasiado grande.': `El IBC no puede superar ${pesos(IBC_MAXIMO)}.`,
});

/**
 * Valida el IBC en pesos (mismo formato colombiano del pago, DA-40). Los espacios, también el duro (U+00A0) y el
 * estrecho (U+202F) que deja el formato de moneda, cuentan como espacio.
 * @returns {{ valor?: string, centavos?: number, error?: string }}
 */
export function leerIbc(texto) {
  const limpio = typeof texto === 'string' ? texto.replace(/[\s\u00a0\u202f$]/g, '') : '';
  if (limpio === '') return { error: 'Escriba el IBC de la incapacidad.' };
  const valor = leerValor(limpio);
  if (valor.error) return { error: ERRORES_IBC[valor.error] ?? ERROR_FORMATO_IBC };
  if (valor.centavos > IBC_MAXIMO * 100) return { error: `El IBC no puede superar ${pesos(IBC_MAXIMO)}.` };
  return valor;
}

const aResultado = (dias, ibc) => ({ ibc, dias, ...calcularTramos(dias, aCentavos(ibc)) });

/**
 * Lo que está guardado (HU-21): los totales y el trámite de pensión tal como quedaron en la base. El detalle por tramo
 * se recalcula solo como desglose y se compara con lo guardado: si la regla cambió desde el cálculo, se avisa.
 */
function resultadoGuardado(i) {
  if (i.ibc == null) return null;
  const desglose = calcularTramos(i.diasIncapacidad, aCentavos(i.ibc));
  const valorEmpresa = aCentavos(i.valorEmpresa);
  const valorEPS = aCentavos(i.valorEPS);
  return {
    ibc: i.ibc,
    dias: i.diasIncapacidad,
    valorEmpresa,
    valorEPS,
    tramitePension: i.tramitePension,
    fechaCalculo: i.fechaCalculo,
    tramos: desglose.tramos,
    diasPension: desglose.diasPension,
    desgloseCoincide: desglose.valorEmpresa === valorEmpresa && desglose.valorEPS === valorEPS,
  };
}

export function crearControlReconocimiento({ baseDeDatos }) {
  return {
    /**
     * Apoyo de la Vista: las incapacidades más recientes con su cálculo, si lo tienen, o las que coinciden con la
     * búsqueda (n.º o nombre del colaborador). Solo consulta.
     * @param {string} [q] lo que escribió el auxiliar.
     */
    async consultarReconocimientos(q) {
      const busqueda = leerBusqueda(q);
      if (busqueda?.id === 0) return { total: 0, filas: [], limite: LISTA_MAXIMA, busqueda: busqueda.texto };
      const { total, filas } = await baseDeDatos.consultarParaReconocimiento(LISTA_MAXIMA, busqueda);
      return { total, filas, limite: LISTA_MAXIMA, busqueda: busqueda?.texto ?? '' };
    },

    /** Datos de la pantalla de cálculo: la incapacidad y, si ya se calculó, lo guardado. null si no existe. */
    async prepararReconocimiento(idIncapacidad) {
      const incapacidad = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosReconocimiento(Number(idIncapacidad)) : null;
      if (!incapacidad) return null;
      const resultado = resultadoGuardado(incapacidad);
      return {
        incapacidad,
        resultado,
        tramos: TRAMOS,
        // DA-51: quién paga los días 3 a 180 según la entidad, y si la regla de tramos está por validar para el tipo.
        aCargoDe: incapacidad.entidadTipo === 'ARL' ? 'ARL' : 'EPS',
        reglaPorValidar: incapacidad.tipo !== TIPO_CON_REGLA,
        advertenciaIbc: resultado ? advertenciaIbc(aCentavos(resultado.ibc), incapacidad.fechaInicio) : null,
      };
    },

    /**
     * DS-09: calcularReconocimiento(ibc) → guardarCalculo(ibc, valorEmpresa, valorEPS, tramitePension) — HU-21.
     * El auxiliar ingresa el IBC al calcular; el sistema aplica los tramos a los días registrados (DA-09), marca el
     * trámite de pensión desde el día 181 (DA-10) y guarda el resultado. Calcular otra vez lo reemplaza, salvo si la
     * incapacidad ya está pagada (DA-53).
     * @param {{ ibc?: string }} datos
     * @param {{ id: string }} usuario quien calcula (DA-23).
     * @returns {Promise<null | object>} null si la incapacidad no existe.
     * @throws {ErrorDeValidacion} IBC no válido (`ibc`), o la incapacidad está pagada (`estado`, DA-53).
     */
    async calcularReconocimiento(idIncapacidad, datos, usuario) {
      const incapacidad = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosReconocimiento(Number(idIncapacidad)) : null;
      if (!incapacidad) return null;
      if (incapacidad.estado === 'pagada') throw new ErrorDeValidacion({ estado: MENSAJE_PAGADA });
      const ibc = leerIbc(datos?.ibc);
      if (ibc.error) throw new ErrorDeValidacion({ ibc: ibc.error });

      const resultado = aResultado(incapacidad.diasIncapacidad, ibc.valor);
      const guardado = await baseDeDatos.guardarCalculo(incapacidad.idIncapacidad, {
        ibc: ibc.valor,
        valorEmpresa: centavosATexto(resultado.valorEmpresa),
        valorEPS: centavosATexto(resultado.valorEPS),
        tramitePension: resultado.tramitePension,
      }, usuario.id);
      // Se pagó entre la consulta y el cálculo: la base no lo guardó.
      if (!guardado) throw new ErrorDeValidacion({ estado: MENSAJE_PAGADA });
      return { idIncapacidad: incapacidad.idIncapacidad, ...resultado };
    },
  };
}
