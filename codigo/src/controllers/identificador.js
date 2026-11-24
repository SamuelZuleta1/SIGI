// ¿El valor es un identificador válido (bigint positivo)? Para los números que llegan por la URL o el formulario.
export const esIdentificador = (valor) => /^[1-9]\d{0,17}$/.test(String(valor ?? ''));
