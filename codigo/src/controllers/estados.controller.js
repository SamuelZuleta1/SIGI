// Grupo `estados` del Control de incapacidades — DS-05 (CU-08).
// Operación: obtenerEstados(filtros) → consultarIncapacidades(filtros) → listaEstados (HU-11).
// Solo consulta: no modifica ningún dato (HU-11.CA2).
import { z } from 'zod';
import { ESTADOS_INCAPACIDAD } from '../models/incapacidad.model.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { esIdentificador } from './identificador.js';

// DA-20: el estado inicial no tiene valor (null); en los filtros se llama «registrada».
export const FILTROS_DE_ESTADO = Object.freeze(['registrada', ...ESTADOS_INCAPACIDAD]);

// Máximo de filas que se muestran; si hay más, se pide afinar los filtros.
export const LIMITE_RESULTADOS = 200;
export const LARGO_MAXIMO_COLABORADOR = 100;

// Máximo de colaboradores que puede abarcar la búsqueda por nombre: sus ids van en la URL de cada
// consulta (lista y 5 conteos). Si el texto coincide con más, se pide escribir más del nombre.
export const MAXIMO_COLABORADORES_COINCIDENTES = 200;

/** Minúsculas y sin tildes: «Ana María» y «ana maria» coinciden. */
export const normalizarTexto = (texto) =>
  String(texto).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

const fechaValida = (valor) => {
  // Postgres no tiene año 0: desde el 1 de enero del año 1.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || valor < '0001-01-01') return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor);
};
const fecha = z
  .string()
  .refine((v) => v === '' || fechaValida(v), 'Escriba una fecha válida (día, mes y año).');

const esquemaFiltros = z
  .object({
    estado: z.string().refine((v) => v === '' || FILTROS_DE_ESTADO.includes(v), 'Escoja un estado de la lista.'),
    entidad: z.string().refine((v) => v === '' || esIdentificador(v), 'Escoja una entidad de la lista.'),
    colaborador: z.string().max(LARGO_MAXIMO_COLABORADOR, `El nombre admite máximo ${LARGO_MAXIMO_COLABORADOR} caracteres.`),
    desde: fecha,
    hasta: fecha,
  })
  .refine((f) => !(f.desde && f.hasta && fechaValida(f.desde) && fechaValida(f.hasta)) || f.desde <= f.hasta, {
    path: ['hasta'],
    message: 'La fecha «hasta» no puede ser anterior a «desde».',
  });

/** Lee los filtros tal como llegan de la URL (texto o ausentes; un valor repetido llega como lista). */
export function leerFiltros(consulta = {}) {
  const uno = (v) => texto(Array.isArray(v) ? v[0] : v);
  return {
    estado: uno(consulta.estado),
    entidad: uno(consulta.entidad),
    colaborador: uno(consulta.colaborador),
    desde: uno(consulta.desde),
    hasta: uno(consulta.hasta),
  };
}

const conteosVacios = () => Object.fromEntries(FILTROS_DE_ESTADO.map((e) => [e, 0]));

export function crearControlEstados({ baseDeDatos }) {
  return {
    /** Entidades para el filtro (las mismas del registro: EPS y ARL). */
    async consultarEntidadesDeFiltro() {
      return baseDeDatos.consultarEntidades();
    },

    /**
     * DS-05: obtenerEstados(filtros) → listaEstados — HU-11.CA1.
     * Filtros (DA-20): estado (incluida «registrada» = sin valor), entidad, colaborador (parte del nombre,
     * sin importar tildes ni mayúsculas) y rango de fechas de inicio. Ordena de la más reciente a la más
     * antigua por fecha de inicio. Devuelve también cuántas hay en cada estado con los demás filtros.
     * @returns {Promise<{ filtros, incapacidades: object[], total: number, conteos: object, limitado: boolean }>}
     * @throws {ErrorDeValidacion} algún filtro no es válido.
     */
    async obtenerEstados(consulta) {
      const filtros = leerFiltros(consulta);
      const resultado = esquemaFiltros.safeParse(filtros);
      if (!resultado.success) {
        const errores = {};
        for (const { path, message } of resultado.error.issues) errores[path[0]] ??= message;
        throw new ErrorDeValidacion(errores);
      }

      // El colaborador se busca por nombre en la lista de colaboradores (sin tildes, como lo escribe el auxiliar).
      let colaboradores = null;
      if (filtros.colaborador) {
        const buscado = normalizarTexto(filtros.colaborador);
        colaboradores = (await baseDeDatos.consultarColaboradores())
          .filter((c) => normalizarTexto(c.nombre).includes(buscado))
          .map((c) => c.id);
        if (colaboradores.length > MAXIMO_COLABORADORES_COINCIDENTES) {
          throw new ErrorDeValidacion({ colaborador: 'Hay demasiados colaboradores con ese texto: escriba más del nombre.' });
        }
        if (colaboradores.length === 0) {
          return { filtros, incapacidades: [], total: 0, conteos: conteosVacios(), limitado: false };
        }
      }

      const comunes = {
        entidad: filtros.entidad ? Number(filtros.entidad) : null,
        colaboradores,
        desde: filtros.desde || null,
        hasta: filtros.hasta || null,
      };
      const [lista, conteos] = await Promise.all([
        baseDeDatos.consultarIncapacidades({ ...comunes, estado: filtros.estado || null }, LIMITE_RESULTADOS),
        baseDeDatos.contarPorEstado(comunes),
      ]);
      return {
        filtros,
        incapacidades: lista.filas,
        total: lista.total,
        conteos,
        limitado: lista.total > lista.filas.length,
      };
    },
  };
}
