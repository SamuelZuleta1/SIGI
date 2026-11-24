// Modelo: Entidad (CL-01; plazoTranscripcionTransito: P-C). Clase de datos, sin métodos.
export const TIPOS_ENTIDAD = Object.freeze(['EPS', 'ARL', 'AFP']);

export class Entidad {
  nombre;
  tipo;
  plazoTranscripcion;
  plazoTranscripcionTransito;
  permiteTranscripcionDigital;
}
