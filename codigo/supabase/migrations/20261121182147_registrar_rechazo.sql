-- ---------------------------------------------------------------------------
-- HU-14 (DS-06: guardarRechazo(causal); DA-39): la causal que informa la entidad se guarda en
-- causal_rechazo al pasar la incapacidad a «rechazada». Se conserva la causal del último rechazo
-- aunque luego se radique de nuevo (la línea de tiempo la muestra).
--
-- Sin incapacidades rechazadas en la nube (comprobado el 2026-11-21): las restricciones no
-- chocan con datos existentes.
-- ---------------------------------------------------------------------------
comment on column public.incapacidad.causal_rechazo is
  'Causal del último rechazo informado por la entidad, de 3 a 500 caracteres (HU-14, DA-39).';

alter table public.incapacidad
  -- Mismo límite que valida el Control.
  add constraint incapacidad_causal_rechazo_largo check (char_length(causal_rechazo) between 3 and 500),
  -- Una incapacidad rechazada siempre tiene su causal (HU-14.CA1).
  add constraint incapacidad_rechazada_con_causal check (estado is distinct from 'rechazada' or causal_rechazo is not null);
