// Modelo: Usuario (tabla técnica, DA-02). Clase de datos, sin métodos.
export const ROLES = Object.freeze(['receptor', 'lider', 'auxiliar', 'contabilidad', 'cartera']);

export class Usuario {
  id;
  correo;
  rol;
}
