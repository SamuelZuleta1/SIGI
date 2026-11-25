-- ---------------------------------------------------------------------------
-- Auditoría de las HU (pendientes) — HU-18/HU-19, decisión 4A («2 requerimientos siempre»). Cambia DA-05, DA-14,
-- DA-43 y DA-44:
--   * El traslado lleva una causal de una lista cerrada (causal_traslado) además del motivo (el detalle libre):
--       180_dias  — la incapacidad sigue «cobrada» y pasaron 180 días o más desde fecha_cobrada;
--       deterioro — deterioro crediticio de la entidad: «cobrada», aunque no haya demora;
--       rechazo   — la entidad la rechazó: «rechazada» (en vez de radicarla de nuevo).
--   * Toda causal exige mínimo 2 requerimientos (RN-09): se exige, ya no solo se advierte (DA-14).
--   * Los requerimientos se registran en una «cobrada» (con o sin demora) o una «rechazada», sin trasladar y sin dar
--     de baja (DA-43 pedía demora; DA-05 excluía las rechazadas).
--   * Cartera y Jurídica decide también sobre una rechazada trasladada (registrar_decision).
--   * Una rechazada trasladada por rechazo admite el pago (registrar_pago): pasa a «pagada» sin tiempo de pago (nunca
--     fue cobrada); si se anulan todos sus pagos, vuelve a «rechazada» (anular_pago).
-- Todas bloquean la fila de la incapacidad (FOR UPDATE), como antes. `p_fecha` = hoy en Colombia (lo da el Control).
-- SECURITY INVOKER (por defecto), search_path vacío; solo service_role las ejecuta.
-- ---------------------------------------------------------------------------

alter table public.incapacidad
  add column causal_traslado text;

alter table public.incapacidad
  add constraint incapacidad_causal_traslado_valida check (causal_traslado in ('180_dias', 'deterioro', 'rechazo')),
  add constraint incapacidad_causal_con_motivo check ((causal_traslado is null) = (motivo_traslado is null));

-- Una pagada tiene tiempo de pago, salvo la rechazada que Cartera recuperó (nunca fue cobrada).
alter table public.incapacidad
  drop constraint incapacidad_pagada_con_tiempo,
  add constraint incapacidad_pagada_con_tiempo check (
    estado is distinct from 'pagada' or tiempo_pago is not null or causal_traslado = 'rechazo'
  );

comment on column public.incapacidad.causal_traslado is
  'Causal del traslado a Cartera y Jurídica (auditoría HU-19): 180_dias, deterioro o rechazo; motivo_traslado es el detalle.';

-- ---------------------------------------------------------------------------
-- registrar_requerimiento (HU-18): cobrada (con o sin demora) o rechazada, sin trasladar y sin dar de baja.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_requerimiento(
  p_incapacidad_id bigint,
  p_fundamentos    text,
  p_creado_por     uuid
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_requerimiento_id bigint;
begin
  perform 1
  from public.incapacidad
  where id = p_incapacidad_id
    and estado in ('cobrada', 'rechazada')
    and decision is distinct from 'dar_de_baja'
    and motivo_traslado is null
  for update;

  if not found then
    return null;
  end if;

  insert into public.requerimiento (incapacidad_id, fundamentos, creado_por)
  values (p_incapacidad_id, p_fundamentos, p_creado_por)
  returning id into v_requerimiento_id;

  return v_requerimiento_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- trasladar_a_cartera (HU-19): con la causal; mínimo 2 requerimientos y la condición de la causal.
-- Devuelve true si trasladó; false si no se cumplen las condiciones, ya estaba trasladada o no existe.
-- ---------------------------------------------------------------------------
drop function public.trasladar_a_cartera(bigint, text, date);

create function public.trasladar_a_cartera(
  p_incapacidad_id bigint,
  p_causal         text,
  p_motivo         text,
  p_fecha          date
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_estado        text;
  v_fecha_cobrada date;
begin
  select estado, fecha_cobrada into v_estado, v_fecha_cobrada
  from public.incapacidad
  where id = p_incapacidad_id
    and decision is distinct from 'dar_de_baja'
    and motivo_traslado is null
  for update;

  if not found then
    return false;
  end if;

  -- RN-09: mínimo dos requerimientos de cobro persuasivo, para cualquier causal.
  if (select count(*) from public.requerimiento where incapacidad_id = p_incapacidad_id) < 2 then
    return false;
  end if;

  if not (
    (p_causal = '180_dias' and v_estado = 'cobrada' and p_fecha >= v_fecha_cobrada + 180)
    or (p_causal = 'deterioro' and v_estado = 'cobrada')
    or (p_causal = 'rechazo' and v_estado = 'rechazada')
  ) then
    return false;
  end if;

  update public.incapacidad
  set causal_traslado = p_causal,
      motivo_traslado = p_motivo,
      fecha_traslado  = p_fecha
  where id = p_incapacidad_id;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- registrar_decision (HU-20): también sobre una rechazada trasladada.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_decision(
  p_incapacidad_id bigint,
  p_decision       text,
  p_fecha          date
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.incapacidad
  where id = p_incapacidad_id
    and estado in ('cobrada', 'rechazada')
    and motivo_traslado is not null
    and decision is null
  for update;

  if not found then
    return false;
  end if;

  update public.incapacidad
  set decision       = p_decision,
      fecha_decision = p_fecha
  where id = p_incapacidad_id;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- registrar_pago (HU-15): también sobre una rechazada trasladada por rechazo.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_pago(
  p_incapacidad_id bigint,
  p_valor          numeric,
  p_fecha_pago     date,
  p_creado_por     uuid
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_pago_id bigint;
begin
  update public.incapacidad
  set estado = 'pagada'
  where id = p_incapacidad_id
    and (estado in ('cobrada', 'pagada') or (estado = 'rechazada' and causal_traslado = 'rechazo'))
    and fecha_archivo_preparado is null;

  if not found then
    return null;
  end if;

  insert into public.pago (incapacidad_id, valor, fecha_pago, creado_por)
  values (p_incapacidad_id, p_valor, p_fecha_pago, p_creado_por)
  returning id into v_pago_id;

  return v_pago_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- anular_pago (auditoría HU-15): sin pagos vigentes vuelve a «cobrada» o, si nunca lo fue (rechazada recuperada),
-- a «rechazada».
-- ---------------------------------------------------------------------------
create or replace function public.anular_pago(
  p_pago_id bigint,
  p_motivo  text,
  p_por     uuid
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_incapacidad_id bigint;
begin
  select incapacidad_id into v_incapacidad_id from public.pago where id = p_pago_id;
  if not found then
    return false;
  end if;

  perform 1
  from public.incapacidad
  where id = v_incapacidad_id
    and fecha_archivo_preparado is null
    and not enviada_a_gestion_documental
  for update;
  if not found then
    return false;
  end if;

  update public.pago
  set anulado_en = now(), anulado_por = p_por, motivo_anulacion = p_motivo
  where id = p_pago_id
    and anulado_en is null
    and conciliacion_id is null;
  if not found then
    return false;
  end if;

  update public.incapacidad
  set estado = case when tiempo_pago is null then 'rechazada' else 'cobrada' end
  where id = v_incapacidad_id
    and estado = 'pagada'
    and not exists (select 1 from public.pago where incapacidad_id = v_incapacidad_id and anulado_en is null);

  return true;
end;
$$;

revoke execute on function public.trasladar_a_cartera(bigint, text, text, date) from public, anon, authenticated;
grant execute on function public.trasladar_a_cartera(bigint, text, text, date) to service_role;
