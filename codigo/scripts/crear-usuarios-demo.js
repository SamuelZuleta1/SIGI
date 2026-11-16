// Crea los 10 usuarios de demostración (DA-02): 2 por cada rol, dominio reservado @sigi.test.
// Se crean en Supabase Auth ya confirmados y se registran en la tabla `usuario` con su rol.
// Uso: npm run db:usuarios   (se puede repetir: no duplica).
import 'dotenv/config';
import { crearClienteServidor } from '../src/config/supabase.js';
import { ROLES } from '../src/models/usuario.model.js';

const contrasena = process.env.DEMO_PASSWORD;
if (!contrasena || contrasena.length < 8) {
  console.error('Defina DEMO_PASSWORD (mínimo 8 caracteres) en .env');
  process.exit(1);
}

const supabase = crearClienteServidor();
const usuarios = ROLES.flatMap((rol) => [1, 2].map((n) => ({ correo: `${rol}${n}@sigi.test`, rol })));

const { data: existentes, error: errorLista } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (errorLista) throw errorLista;
const idPorCorreo = new Map(existentes.users.map((u) => [u.email, u.id]));

for (const { correo, rol } of usuarios) {
  let id = idPorCorreo.get(correo);
  if (!id) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: correo,
      password: contrasena,
      email_confirm: true,
    });
    if (error) throw error;
    id = data.user.id;
  }
  const { error } = await supabase.from('usuario').upsert({ id, correo, rol });
  if (error) throw error;
  console.log(`${correo} → ${rol}`);
}
console.log(`Listo: ${usuarios.length} usuarios de demostración.`);
