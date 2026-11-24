-- ---------------------------------------------------------------------------
-- HU-13 (DS-06: guardarEstado(cobrada, tiempoPago); DA-38): el tiempo de pago que informa la
-- entidad se guarda como número de días calendario, junto con la fecha en que quedó cobrada.
-- Así HU-16 (evaluarDemora) calcula la fecha prometida: fecha_cobrada + tiempo_pago días.
--
-- tiempo_pago era text y no tenía datos (comprobado en la nube el 2026-11-21): el cambio de tipo
-- no pierde información. Si alguna fila tuviera texto no numérico, la conversión falla y la
-- migración se revierte entera.
-- ---------------------------------------------------------------------------
alter table public.incapacidad
  alter column tiempo_pago type integer using tiempo_pago::integer,
  add column fecha_cobrada date;

comment on column public.incapacidad.tiempo_pago is
  'Días calendario en que la entidad prometió pagar, contados desde fecha_cobrada (HU-13, DA-38).';
comment on column public.incapacidad.fecha_cobrada is
  'Fecha (Colombia) en que se registró la incapacidad como cobrada (HU-13, DA-38).';

alter table public.incapacidad
  -- Un plazo de pago razonable: de 1 día a 1 año (lo valida también el Control).
  add constraint incapacidad_tiempo_pago_rango check (tiempo_pago between 1 and 365),
  -- Los dos datos del cobro van juntos: o están ambos o ninguno.
  add constraint incapacidad_cobro_completo check ((tiempo_pago is null) = (fecha_cobrada is null)),
  -- Una incapacidad cobrada siempre tiene su tiempo de pago (HU-13.CA1).
  add constraint incapacidad_cobrada_con_tiempo check (estado is distinct from 'cobrada' or tiempo_pago is not null);
