-- ---------------------------------------------------------------------------
-- HU-26 (DS-11: identificarPagos(entidad, detallePagos) → obtenerPagosConsignados → compararPagos →
-- guardarConciliacion(detalle) | guardarSaldosPendientes(saldos); DA-11, DA-56).
--   * Cada pago consignado y cada pago registrado (HU-15) queda enlazado a la conciliación que lo identificó
--     (`conciliacion_id`). Un pago consignado sin conciliación sigue «por identificar».
--   * `pago.conciliado` (DA-11) se conserva y siempre coincide con el enlace (restricción).
--   * registrar_conciliacion guarda todo en una transacción: la fila de la conciliación (detalle y saldos), los
--     enlaces y la marca `conciliado`. Bloquea la entidad (FOR UPDATE) para que dos conciliaciones de la misma
--     entidad no se crucen, y comprueba que lo que comparó el servidor sigue igual:
--       - los pagos consignados por identificar de la entidad son exactamente `p_consignados_vistos`;
--       - cada par (pago consignado, pago) sigue libre y es de la entidad.
--     Si algo cambió, no guarda nada y devuelve null (la pantalla pide volver a revisar).
--   * deshacer_conciliacion la borra y libera sus pagos (si el correo a Contabilidad falla: DA-44/DA-47).
--
-- SECURITY INVOKER (por defecto): las ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarlas.
-- ---------------------------------------------------------------------------
alter table public.pago_consignado
  add column conciliacion_id bigint references public.conciliacion (id);
create index pago_consignado_conciliacion_id_idx on public.pago_consignado (conciliacion_id);
-- Los pendientes de una entidad (la consulta de HU-26): índice parcial, solo los que siguen por identificar.
create index pago_consignado_por_identificar_idx on public.pago_consignado (entidad_id) where conciliacion_id is null;

alter table public.pago
  add column conciliacion_id bigint references public.conciliacion (id);
create index pago_conciliacion_id_idx on public.pago (conciliacion_id);
alter table public.pago
  add constraint pago_conciliado_con_conciliacion check (conciliado = (conciliacion_id is not null));

create function public.registrar_conciliacion(
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

  -- Los pendientes de la entidad son los mismos que comparó el servidor.
  if (
    select coalesce(array_agg(id order by id), '{}')
    from public.pago_consignado
    where entidad_id = p_entidad_id and conciliacion_id is null
  ) is distinct from (
    select coalesce(array_agg(x order by x), '{}') from unnest(p_consignados_vistos) as x
  ) then
    return null;
  end if;

  -- Cada pago registrado del par sigue sin conciliar y es de una incapacidad de la entidad.
  select count(*) into v_libres
  from public.pago p
  join public.incapacidad i on i.id = p.incapacidad_id
  where p.id in (select (e ->> 'pago')::bigint from jsonb_array_elements(p_pares) as e)
    and i.entidad_id = p_entidad_id
    and p.conciliacion_id is null;
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

create function public.deshacer_conciliacion(p_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.pago set conciliado = false, conciliacion_id = null where conciliacion_id = p_id;
  update public.pago_consignado set conciliacion_id = null where conciliacion_id = p_id;
  delete from public.conciliacion where id = p_id;
end;
$$;

revoke execute on function public.registrar_conciliacion(bigint, bigint[], jsonb, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_conciliacion(bigint, bigint[], jsonb, jsonb, jsonb, uuid)
  to service_role;
revoke execute on function public.deshacer_conciliacion(bigint)
  from public, anon, authenticated;
grant execute on function public.deshacer_conciliacion(bigint)
  to service_role;

comment on column public.pago_consignado.conciliacion_id is
  'Conciliación que identificó este pago consignado (HU-26, DA-56); null mientras está por identificar.';
comment on column public.pago.conciliacion_id is
  'Conciliación en la que se identificó este pago (HU-26, DA-11, DA-56); coincide con conciliado.';
