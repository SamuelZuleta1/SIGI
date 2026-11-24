-- ---------------------------------------------------------------------------
-- HU-29 (DS-13: archivarIncapacidad → obtenerEstadoPago → eliminarEpicrisis → enviarParaArchivo → archivoPreparado;
-- DA-11, DA-12, DA-59).
--   * «Archivo preparado» queda guardado con quién y cuándo (DA-23): fecha_archivo_preparado, archivo_preparado_por.
--     HU-30 (T-30) parte de ahí para registrar el envío a Gestión Documental (enviada_a_gestion_documental).
--   * preparar_archivo marca el archivo preparado solo si la incapacidad está pagada, no se preparó antes y su pago
--     está identificado y conciliado: tiene al menos un pago y todos sus pagos están conciliados (DA-11, DA-59).
--     Bloquea la fila (FOR UPDATE) antes de mirar los pagos: si a la vez se registra un pago (registrar_pago), uno
--     espera al otro y no se prepara el archivo con un pago sin conciliar. Devuelve true si la marcó.
--   * deshacer_archivo_preparado quita la marca si el correo a Gestión Documental falla (como DA-44/DA-47).
--   * registrar_pago ya no admite pagos sobre una incapacidad con el archivo preparado.
--   * La epicrisis se elimina desde el servidor (Storage + filas de documento), después de marcar: ver
--     archivo.persistence.js.
--
-- SECURITY INVOKER (por defecto): las ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarlas.
-- ---------------------------------------------------------------------------
alter table public.incapacidad
  add column fecha_archivo_preparado timestamptz,
  add column archivo_preparado_por   uuid references public.usuario (id);

alter table public.incapacidad
  add constraint incapacidad_archivo_auditado check (
    (fecha_archivo_preparado is null) = (archivo_preparado_por is null)
  ),
  add constraint incapacidad_archivo_de_pagada check (
    fecha_archivo_preparado is null or estado = 'pagada'
  ),
  add constraint incapacidad_envio_con_archivo check (
    not enviada_a_gestion_documental or fecha_archivo_preparado is not null
  );

create index incapacidad_archivo_preparado_por_idx on public.incapacidad (archivo_preparado_por);

comment on column public.incapacidad.fecha_archivo_preparado is
  'Cuándo se preparó el archivo: pago conciliado, epicrisis eliminada y correo a Gestión Documental (HU-29, DA-59).';
comment on column public.incapacidad.archivo_preparado_por is 'Quién preparó el archivo (HU-29, DA-23).';

create function public.preparar_archivo(
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

  -- Con la fila bloqueada: al menos un pago y todos conciliados (DA-11).
  if not exists (select 1 from public.pago where incapacidad_id = p_incapacidad_id)
     or exists (select 1 from public.pago where incapacidad_id = p_incapacidad_id and not conciliado) then
    return false;
  end if;

  update public.incapacidad
  set fecha_archivo_preparado = now(),
      archivo_preparado_por   = p_por
  where id = p_incapacidad_id;

  return true;
end;
$$;

create function public.deshacer_archivo_preparado(p_incapacidad_id bigint)
returns void
language sql
set search_path = ''
as $$
  update public.incapacidad
  set fecha_archivo_preparado = null,
      archivo_preparado_por   = null
  where id = p_incapacidad_id
    and not enviada_a_gestion_documental;
$$;

-- registrar_pago (HU-15): igual que antes, pero no sobre una incapacidad con el archivo preparado (DA-59).
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
    and estado in ('cobrada', 'pagada')
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

revoke execute on function public.preparar_archivo(bigint, uuid) from public, anon, authenticated;
grant execute on function public.preparar_archivo(bigint, uuid) to service_role;
revoke execute on function public.deshacer_archivo_preparado(bigint) from public, anon, authenticated;
grant execute on function public.deshacer_archivo_preparado(bigint) to service_role;
revoke execute on function public.registrar_pago(bigint, numeric, date, uuid) from public, anon, authenticated;
grant execute on function public.registrar_pago(bigint, numeric, date, uuid) to service_role;
