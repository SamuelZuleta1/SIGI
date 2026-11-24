// Preparación de las pruebas HTTP y de integración: Supertest no envía las cabeceras que un navegador sí envía en
// los formularios de SIGI. Sin ellas, mismoOrigen (CSRF) rechazaría todos los POST. Cada petición sale como si
// viniera de una página del propio sitio (`Sec-Fetch-Site: same-origin`), salvo que la prueba fije otra cabecera de
// origen (Sec-Fetch-Site, Origin o Referer) o pida explícitamente ir sin ellas con `.sinNavegador()`.
import Test from 'supertest/lib/test.js';

const terminar = Test.prototype.end;

Test.prototype.sinNavegador = function sinNavegador() {
  this._sinNavegador = true;
  return this;
};

Test.prototype.end = function end(...argumentos) {
  const fijada = ['sec-fetch-site', 'origin', 'referer'].some((cabecera) => this.get(cabecera) !== undefined);
  if (!this._sinNavegador && !fijada) this.set('Sec-Fetch-Site', 'same-origin');
  return terminar.apply(this, argumentos);
};
