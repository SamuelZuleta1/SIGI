-- ---------------------------------------------------------------------------
-- HU-14 (DA-39): fecha (Colombia) en que se registró el último rechazo, para mostrarla en la línea de
-- tiempo junto a su causal. Como la causal, solo se guarda la del último rechazo y se conserva al
-- radicar de nuevo.
--
-- Sin incapacidades rechazadas en la nube (comprobado el 2026-11-21): no hay filas que completar.
-- ---------------------------------------------------------------------------
alter table public.incapacidad
  add column fecha_rechazo date;

comment on column public.incapacidad.fecha_rechazo is
  'Fecha (Colombia) en que se registró el último rechazo de la entidad (HU-14, DA-39).';

alter table public.incapacidad
  -- La causal y la fecha del rechazo van juntas: o están ambas o ninguna.
  add constraint incapacidad_rechazo_completo check ((causal_rechazo is null) = (fecha_rechazo is null));
