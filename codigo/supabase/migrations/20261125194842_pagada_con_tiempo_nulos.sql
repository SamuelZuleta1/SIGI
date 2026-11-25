-- ---------------------------------------------------------------------------
-- Corrección de 20261125193654_traslado_causales: en incapacidad_pagada_con_tiempo, `causal_traslado = 'rechazo'` es
-- NULL cuando no hay traslado, y un CHECK que da NULL se cumple: una «pagada» sin tiempo de pago quedaba admitida.
-- Ahora la excepción (rechazada que Cartera recuperó) se compara sin NULL.
-- ---------------------------------------------------------------------------
alter table public.incapacidad
  drop constraint incapacidad_pagada_con_tiempo,
  add constraint incapacidad_pagada_con_tiempo check (
    estado is distinct from 'pagada' or tiempo_pago is not null or causal_traslado is not distinct from 'rechazo'
  );
