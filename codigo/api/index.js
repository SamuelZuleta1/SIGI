// Punto de entrada de Vercel: una sola función serverless con toda la aplicación Express (ver vercel.json).
import { crearAppDeProduccion } from '../src/arranque.js';

export default await crearAppDeProduccion();
