-- Registro atómico (HU-03 y HU-04): cada operación de DS-01 que escribe en varias tablas
-- se ejecuta en una sola transacción. Si un paso falla, no queda nada a medias:
--   * registrar_incapacidad: no queda un colaborador creado sin su incapacidad.
--   * registrar_documentos: no quedan documentos sin la marca de original pendiente (ni al revés).
--
-- SECURITY INVOKER (por defecto): las ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarlas.

-- ---------------------------------------------------------------------------
-- DS-01: guardarIncapacidad. Crea el colaborador si no existe (DA-03, DA-04) y la incapacidad.
-- ---------------------------------------------------------------------------
create function public.registrar_incapacidad(
  p_nombre          text,
  p_correo          text,
  p_entidad_id      bigint,
  p_tipo            text,
  p_fecha_inicio    date,
  p_dias            integer,
  p_fecha_recepcion date,
  p_creado_por      uuid
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_colaborador_id bigint;
  v_incapacidad_id bigint;
begin
  -- «Insertar si no existe» sin choque entre registros simultáneos; si ya existe, se usa el guardado.
  insert into public.colaborador (nombre, correo, creado_por)
  values (p_nombre, p_correo, p_creado_por)
  on conflict (correo) do nothing;

  select c.id into strict v_colaborador_id
  from public.colaborador c
  where c.correo = p_correo;

  insert into public.incapacidad
    (colaborador_id, entidad_id, tipo, fecha_inicio, dias_incapacidad, fecha_recepcion, creado_por)
  values
    (v_colaborador_id, p_entidad_id, p_tipo, p_fecha_inicio, p_dias, p_fecha_recepcion, p_creado_por)
  returning id into v_incapacidad_id;

  return v_incapacidad_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- DS-01: guardarDocumentos + marcarOriginalPendiente (canal correo, HU-04.CA2).
-- p_documentos: [{ "tipo": "...", "archivo": "incapacidades/..." }]
-- ---------------------------------------------------------------------------
create function public.registrar_documentos(
  p_incapacidad_id     bigint,
  p_documentos         jsonb,
  p_original_pendiente boolean,
  p_creado_por         uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_documentos) is distinct from 'array' or jsonb_array_length(p_documentos) = 0 then
    raise exception 'Se necesita al menos un documento' using errcode = '22023';
  end if;

  insert into public.documento (incapacidad_id, tipo, archivo, creado_por)
  select p_incapacidad_id, d.tipo, d.archivo, p_creado_por
  from jsonb_to_recordset(p_documentos) as d (tipo text, archivo text);

  if p_original_pendiente then
    update public.incapacidad
    set original_pendiente = true
    where id = p_incapacidad_id;
  end if;
end;
$$;

revoke execute on function public.registrar_incapacidad(text, text, bigint, text, date, integer, date, uuid)
  from public, anon, authenticated;
revoke execute on function public.registrar_documentos(bigint, jsonb, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_incapacidad(text, text, bigint, text, date, integer, date, uuid)
  to service_role;
grant execute on function public.registrar_documentos(bigint, jsonb, boolean, uuid)
  to service_role;
