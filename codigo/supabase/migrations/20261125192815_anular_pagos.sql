-- ---------------------------------------------------------------------------
-- Auditoría de las HU (pendientes) — anular un pago (HU-15) o un pago consignado (HU-25) mal digitado, sin borrarlo.
--   * Cada uno guarda quién, cuándo y el motivo (10 a 500 caracteres, sin caracteres de control): anulado_por,
--     anulado_en, motivo_anulacion, los tres juntos (DA-23).
--   * Solo mientras no esté conciliado (un pago con conciliacion_id no se anula) ni el archivo esté preparado o enviado
--     (pago). Las restricciones lo garantizan también fuera de las funciones.
--   * Un pago anulado no cuenta: si la incapacidad se queda sin pagos vigentes, vuelve de «pagada» a «cobrada»
--     (sigue en los pendientes de pago); no bloquea el archivo (preparar_archivo mira solo los vigentes) y no aparece
--     por conciliar. Un consignado anulado no queda «por identificar» ni como saldo pendiente de la entidad.
--   * anular_pago bloquea la incapacidad (como registrar_pago y preparar_archivo) y anular_pago_consignado bloquea la
--     entidad (como registrar_conciliacion): una anulación no se cruza con un pago, un archivo o una conciliación.
--   * registrar_conciliacion y preparar_archivo se reemplazan para no contar los anulados.
--
-- RLS: pago y pago_consignado ya tienen RLS activado sin políticas (solo service_role); las columnas nuevas no cambian
-- eso. SECURITY INVOKER (por defecto), search_path vacío; solo service_role ejecuta las funciones.
-- ---------------------------------------------------------------------------

alter table public.pago
  add column anulado_en       timestamptz,
  add column anulado_por      uuid references public.usuario (id),
  add column motivo_anulacion text;

alter table public.pago
  add constraint pago_anulacion_auditada check (
    (anulado_en is null) = (anulado_por is null) and (anulado_en is null) = (motivo_anulacion is null)
  ),
  add constraint pago_motivo_anulacion_largo check (
    motivo_anulacion is null
    or (char_length(motivo_anulacion) between 10 and 500
        and motivo_anulacion = btrim(motivo_anulacion)
        and motivo_anulacion !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]')
  ),
  add constraint pago_anulado_sin_conciliar check (anulado_en is null or conciliacion_id is null);

create index pago_anulado_por_idx on public.pago (anulado_por);

alter table public.pago_consignado
  add column anulado_en       timestamptz,
  add column anulado_por      uuid references public.usuario (id),
  add column motivo_anulacion text;

alter table public.pago_consignado
  add constraint pago_consignado_anulacion_auditada check (
    (anulado_en is null) = (anulado_por is null) and (anulado_en is null) = (motivo_anulacion is null)
  ),
  add constraint pago_consignado_motivo_anulacion_largo check (
    motivo_anulacion is null
    or (char_length(motivo_anulacion) between 10 and 500
        and motivo_anulacion = btrim(motivo_anulacion)
        and motivo_anulacion !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]')
  ),
  add constraint pago_consignado_anulado_sin_conciliar check (anulado_en is null or conciliacion_id is null);

create index pago_consignado_anulado_por_idx on public.pago_consignado (anulado_por);

-- Los pendientes de una entidad (HU-26): solo los vigentes que siguen por identificar.
drop index public.pago_consignado_por_identificar_idx;
create index pago_consignado_por_identificar_idx
  on public.pago_consignado (entidad_id) where conciliacion_id is null and anulado_en is null;

comment on column public.pago.anulado_en is 'Cuándo se anuló el pago mal digitado (auditoría HU-15); null = vigente.';
comment on column public.pago.motivo_anulacion is 'Por qué se anuló (10 a 500 caracteres).';
comment on column public.pago_consignado.anulado_en is 'Cuándo se anuló el pago consignado mal digitado (auditoría HU-25); null = vigente.';
comment on column public.pago_consignado.motivo_anulacion is 'Por qué se anuló (10 a 500 caracteres).';

-- ---------------------------------------------------------------------------
-- anular_pago: true si lo anuló; false si no existe, ya estaba anulado, está conciliado o el archivo de su
-- incapacidad está preparado o enviado.
-- ---------------------------------------------------------------------------
create function public.anular_pago(
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

  -- Primero la incapacidad (mismo orden que registrar_pago y preparar_archivo), luego el pago.
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

  -- Sin pagos vigentes, la incapacidad vuelve a «cobrada» (conserva su tiempo de pago y su fecha de cobrada).
  update public.incapacidad
  set estado = 'cobrada'
  where id = v_incapacidad_id
    and estado = 'pagada'
    and not exists (select 1 from public.pago where incapacidad_id = v_incapacidad_id and anulado_en is null);

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- anular_pago_consignado: true si lo anuló; false si no existe, ya estaba anulado o ya se identificó en una
-- conciliación.
-- ---------------------------------------------------------------------------
create function public.anular_pago_consignado(
  p_id     bigint,
  p_motivo text,
  p_por    uuid
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_entidad_id bigint;
begin
  select entidad_id into v_entidad_id from public.pago_consignado where id = p_id;
  if not found then
    return false;
  end if;

  -- La entidad, como registrar_conciliacion: no se anula a mitad de una conciliación de la misma entidad.
  perform 1 from public.entidad where id = v_entidad_id for update;

  update public.pago_consignado
  set anulado_en = now(), anulado_por = p_por, motivo_anulacion = p_motivo
  where id = p_id
    and anulado_en is null
    and conciliacion_id is null;

  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- registrar_conciliacion (HU-26, DA-56): igual que antes, sin contar los anulados.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_conciliacion(
  p_entidad_id         bigint,
  p_consignados_vistos bigint[],
  p_pares              jsonb,
  p_detalle            jsonb,
  p_saldos             jsonb,
  p_creado_por         uuid
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_id      bigint;
  v_pares   integer := jsonb_array_length(p_pares);
  v_libres  integer;
begin
  perform 1 from public.entidad where id = p_entidad_id for update;
  if not found then
    return null;
  end if;

  -- Los pendientes vigentes de la entidad son los mismos que comparó el servidor.
  if (
    select coalesce(array_agg(id order by id), '{}')
    from public.pago_consignado
    where entidad_id = p_entidad_id and conciliacion_id is null and anulado_en is null
  ) is distinct from (
    select coalesce(array_agg(x order by x), '{}') from unnest(p_consignados_vistos) as x
  ) then
    return null;
  end if;

  -- Cada pago registrado del par sigue vigente, sin conciliar y es de una incapacidad de la entidad.
  select count(*) into v_libres
  from public.pago p
  join public.incapacidad i on i.id = p.incapacidad_id
  where p.id in (select (e ->> 'pago')::bigint from jsonb_array_elements(p_pares) as e)
    and i.entidad_id = p_entidad_id
    and p.conciliacion_id is null
    and p.anulado_en is null;
  if v_libres <> v_pares
     or v_pares <> (select count(distinct (e ->> 'pago')) from jsonb_array_elements(p_pares) as e)
     or v_pares <> (select count(distinct (e ->> 'consignado')) from jsonb_array_elements(p_pares) as e)
     or exists (
       select 1 from jsonb_array_elements(p_pares) as e
       where not ((e ->> 'consignado')::bigint = any (p_consignados_vistos))
     ) then
    return null;
  end if;

  insert into public.conciliacion (entidad_id, detalle, saldos_pendientes, creado_por)
  values (p_entidad_id, p_detalle, p_saldos, p_creado_por)
  returning id into v_id;

  update public.pago_consignado
  set conciliacion_id = v_id
  where id in (select (e ->> 'consignado')::bigint from jsonb_array_elements(p_pares) as e);

  update public.pago
  set conciliado = true, conciliacion_id = v_id
  where id in (select (e ->> 'pago')::bigint from jsonb_array_elements(p_pares) as e);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- preparar_archivo (HU-29, DA-11, DA-59): igual que antes, mirando solo los pagos vigentes.
-- ---------------------------------------------------------------------------
create or replace function public.preparar_archivo(
  p_incapacidad_id bigint,
  p_por            uuid
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.incapacidad
  where id = p_incapacidad_id
    and estado = 'pagada'
    and fecha_archivo_preparado is null
    and not enviada_a_gestion_documental
  for update;
  if not found then
    return false;
  end if;

  -- Con la fila bloqueada: al menos un pago vigente y todos los vigentes conciliados (DA-11).
  if not exists (select 1 from public.pago where incapacidad_id = p_incapacidad_id and anulado_en is null)
     or exists (select 1 from public.pago where incapacidad_id = p_incapacidad_id and anulado_en is null and not conciliado) then
    return false;
  end if;

  update public.incapacidad
  set fecha_archivo_preparado = now(),
      archivo_preparado_por   = p_por
  where id = p_incapacidad_id;

  return true;
end;
$$;

revoke execute on function public.anular_pago(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.anular_pago(bigint, text, uuid) to service_role;
revoke execute on function public.anular_pago_consignado(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.anular_pago_consignado(bigint, text, uuid) to service_role;
