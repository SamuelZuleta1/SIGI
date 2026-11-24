// Modelo: Reporte (CL-01; contenido: DA-21). Clase de datos, sin métodos.
export const TIPOS_REPORTE = Object.freeze(['ausentismo', 'prolongadas']);

export class Reporte {
  tipo;
  periodo;
  contenido;
}
