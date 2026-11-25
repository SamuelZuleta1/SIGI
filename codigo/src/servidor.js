// Punto de entrada local (`npm start` / `npm run dev`): compone la app real y abre el puerto.
// Va aparte de app.js para que importar la app (pruebas, Vercel) no la ponga a escuchar ni cree un ciclo de imports.
import { crearAppDeProduccion } from './arranque.js';

const puerto = Number(process.env.PORT) || 3000;
(await crearAppDeProduccion()).listen(puerto, () => console.log(`SIGI en http://localhost:${puerto}`));
