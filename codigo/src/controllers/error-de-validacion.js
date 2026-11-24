// Error de los controladores cuando los datos de una operación no son válidos.
// `errores` es { campo: mensaje }; la ruta vuelve a mostrar el formulario con ellos.
export class ErrorDeValidacion extends Error {
  constructor(errores) {
    super('Datos no válidos');
    this.name = 'ErrorDeValidacion';
    this.errores = errores;
  }
}
