-- ---------------------------------------------------------------------------
-- HU-16 (DS-07: registrarSeguimiento(evidencia) → guardarSeguimiento(evidencia); DA-41): guardar el
-- seguimiento semanal de una incapacidad cobrada pendiente de pago.
--   * Solo si está «cobrada» y no se dio de baja (DA-18): una pagada ya no tiene seguimiento.
--   * La fila de la incapacidad se bloquea (FOR UPDATE) mientras se inserta: si a la vez se registra
--     el pago (registrar_pago), uno espera al otro y el seguimiento no queda sobre una pagada.
-- Devuelve el id del seguimiento, o null si el estado no lo permite o la incapacidad no existe.
--
-- SECURITY INVOKER (por defecto): la ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarla.
-- ---------------------------------------------------------------------------
create function public.registrar_seguimiento(
  p_incapacidad_id bigint,
  p_evidencia      text,
  p_creado_por     uuid
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_seguimiento_id bigint;
begin
  perform 1
  from public.incapacidad
  where id = p_incapacidad_id
    and estado = 'cobrada'
    and decision is distinct from 'dar_de_baja'
  for update;

  if not found then
    return null;
  end if;

  insert into public.seguimiento (incapacidad_id, evidencia, creado_por)
  values (p_incapacidad_id, p_evidencia, p_creado_por)
  returning id into v_seguimiento_id;

  return v_seguimiento_id;
end;
$$;

revoke execute on function public.registrar_seguimiento(bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_seguimiento(bigint, text, uuid)
  to service_role;

-- HU-16.CA3: el seguimiento siempre lleva la evidencia de la gestión (archivo en Storage, P-D).
-- La tabla no tenía filas (nada la escribía antes de HU-16); si las tuviera sin evidencia, la migración falla entera.
alter table public.seguimiento
  alter column evidencia set not null,
  add constraint seguimiento_evidencia_ruta check (evidencia like 'incapacidades/%');

-- La lista de pendientes (HU-16) filtra por estado; un índice parcial la mantiene pequeña y rápida.
create index incapacidad_cobradas_idx on public.incapacidad (id) where estado = 'cobrada';
