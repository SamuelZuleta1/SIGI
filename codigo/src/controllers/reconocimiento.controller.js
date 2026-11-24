// Grupo `reconocimiento` del Control de incapacidades — DS-09 (CU-13).
// Operaciones: consultarReconocimientos y prepararReconocimiento (apoyo de la Vista) y
// calcularReconocimiento(ibc) → guardarCalculo (HU-21).
import { aCentavos, centavosATexto, pesos } from '../servicios/moneda.js';
import { advertenciaIbc } from '../servicios/smmlv.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { leerValor } from './cobro.controller.js';
import { MAXIMO_COLABORADORES_COINCIDENTES, normalizarTexto } from './estados.controller.js';
import { esIdentificador } from './identificador.js';

// Tramos por regla (DA-09, DA-51). IBC diario = IBC ÷ 30. `aCargo: 'eps'` es la entidad del caso (EPS o ARL): su valor
// se guarda en valor_eps. Con prórrogas (DA-50), cada certificado cubre sus días dentro del caso: la prórroga que va del
// día 31 al 60 ya no paga los días 1 y 2 a la empresa, y desde el día 91 aplica el 50 %.
export const DIAS_DEL_MES = 30;
export const REGLAS = Object.freeze({
  // Origen común (enfermedad general y accidente de tránsito): días 1–2 la empresa; 3–90 al 67 % y 91–180 al 50 % la EPS.
  comun: Object.freeze([
    { clave: 'empresa', nombre: 'Días 1 y 2', desde: 1, hasta: 2, porcentaje: 100, aCargo: 'empresa' },
    { clave: 'eps_1', nombre: 'Días 3 a 90', desde: 3, hasta: 90, porcentaje: 67, aCargo: 'eps' },
    { clave: 'eps_2', nombre: 'Días 91 a 180', desde: 91, hasta: 180, porcentaje: 50, aCargo: 'eps' },
  ]),
  // Origen laboral (Ley 776 de 2002, art. 3): el día del accidente o del diagnóstico lo paga la empresa; desde el día
  // siguiente, la ARL al 100 %.
  laboral: Object.freeze([
    { clave: 'empresa', nombre: 'Día 1 (día del evento)', desde: 1, hasta: 1, porcentaje: 100, aCargo: 'empresa' },
    { clave: 'eps_1', nombre: 'Días 2 a 180', desde: 2, hasta: 180, porcentaje: 100, aCargo: 'eps' },
  ]),
  // Licencias de maternidad y paternidad (Ley 2114 de 2021): la EPS paga el 100 % de todos los días; la empresa nada.
  licencia: Object.freeze([
    { clave: 'eps_1', nombre: 'Todos los días', desde: 1, hasta: Number.MAX_SAFE_INTEGER, porcentaje: 100, aCargo: 'eps' },
  ]),
});
const REGLA_POR_TIPO = Object.freeze({
  enfermedad_general: 'comun',
  accidente_transito: 'comun',
  accidente_laboral: 'laboral',
  enfermedad_laboral: 'laboral',
  licencia_maternidad: 'licencia',
  licencia_paternidad: 'licencia',
});
/** La regla de tramos del tipo de incapacidad (DA-51). Un tipo desconocido usa la de origen común. */
export const reglaDe = (tipo) => REGLA_POR_TIPO[tipo] ?? 'comun';
// Compatibilidad: los tramos de origen común (DA-09).
export const TRAMOS = REGLAS.comun;
// HU-21: desde el día 181 el sistema marca el trámite de pensión (DA-10).
export const DIA_TRAMITE_PENSION = 181;
export const LISTA_MAXIMA = 200;
// Búsqueda de la lista (auditoría de T-21 a T-24, opción A): un solo campo, n.º de incapacidad o nombre del colaborador.
export const BUSQUEDA_MAXIMA = 60;

/**
 * Lee la búsqueda de la lista. Solo cifras = n.º exacto de la incapacidad; si no, parte del nombre del colaborador.
 * @returns {null | { texto: string, id?: number, nombre?: string }} null si no hay búsqueda.
 */
export function leerBusqueda(valor) {
  const texto = typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim().slice(0, BUSQUEDA_MAXIMA) : '';
  if (texto === '') return null;
  // Un número que no puede ser un id (cero, demasiado largo) no coincide con nada.
  if (/^\d+$/.test(texto)) return { texto, id: esIdentificador(texto) ? Number(texto) : 0 };
  return { texto, nombre: texto };
}
// numeric(14,2) guarda hasta 12 cifras enteras y la EPS llega a ~3,5 veces el IBC: con este tope ningún valor desborda.
export const IBC_MAXIMO = 10_000_000_000;
// DA-53: el reconocimiento se puede recalcular en cualquier estado menos «pagada».

export const MENSAJE_PAGADA = 'La incapacidad está pagada: su reconocimiento ya no se calcula ni se cambia.';

/**
 * Aplica los tramos de la regla del tipo (DA-09, DA-51) a un certificado de `dias` días con un IBC en centavos enteros.
 * El certificado cubre los días `diasPrevios + 1` a `diasPrevios + dias` del caso (DA-50; 0 si no es prórroga).
 * Cada tramo se redondea al centavo; el valor de la entidad es la suma de sus tramos ya redondeados, así el detalle
 * siempre suma el total. Las licencias no pasan a trámite de pensión.
 * @param {string} [tipo] tipo de la incapacidad; sin tipo, la regla de origen común.
 * @param {number} [diasPrevios] días del caso antes de este certificado.
 * @returns {{ tramos: object[], valorEmpresa: number, valorEPS: number, tramitePension: boolean, diasPension: number }} en centavos.
 */
export function calcularTramos(dias, ibcCentavos, tipo, diasPrevios = 0) {
  const regla = reglaDe(tipo);
  const primero = diasPrevios + 1;
  const ultimo = diasPrevios + dias;
  const tramos = REGLAS[regla].map((t) => {
    const diasDelTramo = Math.max(0, Math.min(ultimo, t.hasta) - Math.max(primero, t.desde) + 1);
    const valor = Math.round((ibcCentavos * diasDelTramo * t.porcentaje) / (DIAS_DEL_MES * 100));
    return { ...t, dias: diasDelTramo, valor };
  });
  const suma = (aCargo) => tramos.filter((t) => t.aCargo === aCargo).reduce((total, t) => total + t.valor, 0);
  const conPension = regla !== 'licencia';
  return {
    tramos,
    valorEmpresa: suma('empresa'),
    valorEPS: suma('eps'),
    tramitePension: conPension && ultimo >= DIA_TRAMITE_PENSION,
    diasPension: conPension ? Math.max(0, ultimo - Math.max(DIA_TRAMITE_PENSION, primero) + 1) : 0,
  };
}

// Los mensajes de leerValor hablan del pago (HU-15); el IBC pasa los suyos.
const MENSAJES_IBC = Object.freeze({
  vacio: 'Escriba el IBC de la incapacidad.',
  formato: 'Escriba el IBC en pesos, por ejemplo 2.800.000 o 2.800.000,50.',
  grande: `El IBC no puede superar ${pesos(IBC_MAXIMO)}.`,
  cero: 'El IBC debe ser mayor que cero.',
});

/**
 * Valida el IBC en pesos (mismo formato colombiano del pago, DA-40). Los espacios, también el duro (U+00A0) y el
 * estrecho (U+202F) que deja el formato de moneda, cuentan como espacio.
 * @returns {{ valor?: string, centavos?: number, error?: string }}
 */
export function leerIbc(texto) {
  const valor = leerValor(typeof texto === 'string' ? texto : '', MENSAJES_IBC);
  if (valor.error) return valor;
  if (valor.centavos > IBC_MAXIMO * 100) return { error: MENSAJES_IBC.grande };
  return valor;
}

const aResultado = (i, ibc) => ({ ibc, dias: i.diasIncapacidad, ...calcularTramos(i.diasIncapacidad, aCentavos(ibc), i.tipo, i.diasPrevios ?? 0) });

/**
 * Lo que está guardado (HU-21): los totales y el trámite de pensión tal como quedaron en la base. El detalle por tramo
 * se recalcula solo como desglose y se compara con lo guardado: si la regla cambió desde el cálculo, se avisa.
 */
function resultadoGuardado(i) {
  if (i.ibc == null) return null;
  const desglose = calcularTramos(i.diasIncapacidad, aCentavos(i.ibc), i.tipo, i.diasPrevios ?? 0);
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
     * búsqueda (n.º o nombre del colaborador, sin tildes ni mayúsculas). Solo consulta.
     * @param {string} [q] lo que escribió el auxiliar.
     */
    async consultarReconocimientos(q) {
      const busqueda = leerBusqueda(q);
      const vacia = (extra = {}) => ({ total: 0, filas: [], limite: LISTA_MAXIMA, busqueda: busqueda.texto, ...extra });
      if (busqueda?.id === 0) return vacia();
      let filtro = busqueda?.id ? { id: busqueda.id } : null;
      if (busqueda?.nombre) {
        // Sin tildes ni mayúsculas, como la consulta de estados (HU-11): «gomez» encuentra a «Gómez».
        const buscado = normalizarTexto(busqueda.nombre);
        const colaboradores = (await baseDeDatos.consultarColaboradores())
          .filter((c) => normalizarTexto(c.nombre).includes(buscado))
          .map((c) => c.id);
        if (colaboradores.length === 0) return vacia();
        if (colaboradores.length > MAXIMO_COLABORADORES_COINCIDENTES) return vacia({ demasiados: true });
        filtro = { colaboradores };
      }
      const { total, filas } = await baseDeDatos.consultarParaReconocimiento(LISTA_MAXIMA, filtro);
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
        tramos: REGLAS[reglaDe(incapacidad.tipo)],
        regla: reglaDe(incapacidad.tipo),
        // DA-51: la entidad que paga su parte (EPS o ARL).
        aCargoDe: incapacidad.entidadTipo === 'ARL' ? 'ARL' : 'EPS',
        advertenciaIbc: resultado ? advertenciaIbc(aCentavos(resultado.ibc), incapacidad.fechaInicio) : null,
      };
    },

    /**
     * DS-09: calcularReconocimiento(ibc) → guardarCalculo(ibc, valorEmpresa, valorEPS, tramitePension) — HU-21.
     * El auxiliar ingresa el IBC al calcular; el sistema aplica los tramos a los días registrados (DA-09), marca el
     * trámite de pensión desde el día 181 (DA-10; no en las licencias) y guarda el resultado. Calcular otra vez lo reemplaza, salvo si la
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

      const resultado = aResultado(incapacidad, ibc.valor);
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
