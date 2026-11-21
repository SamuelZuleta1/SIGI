-- ---------------------------------------------------------------------------
-- HU-17.CA2 (DS-07: registrarAcuerdo(acuerdo) → guardarAcuerdo(acuerdo); DA-42): guardar el acuerdo de pago que
-- la Coordinación logró con la entidad (fecha y valor).
--   * Solo si la incapacidad sigue «cobrada» y no se dio de baja (DA-18), como registrar_seguimiento; la demora
--     (fecha prometida vencida) la exige el Control, que es quien conoce la fecha de hoy en Colombia.
--   * La fila de la incapacidad se bloquea (FOR UPDATE) para no cruzarse con un pago simultáneo.
-- Devuelve el id del acuerdo, o null si el estado no lo permite o la incapacidad no existe.
--
-- SECURITY INVOKER (por defecto): la ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarla.
-- ---------------------------------------------------------------------------
create function public.registrar_acuerdo(
  p_incapacidad_id bigint,
  p_fecha          date,
  p_valor          numeric,
  p_creado_por     uuid
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_acuerdo_id bigint;
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

  insert into public.acuerdo_pago (incapacidad_id, fecha, valor, creado_por)
  values (p_incapacidad_id, p_fecha, p_valor, p_creado_por)
  returning id into v_acuerdo_id;

  return v_acuerdo_id;
end;
$$;

revoke execute on function public.registrar_acuerdo(bigint, date, numeric, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_acuerdo(bigint, date, numeric, uuid)
  to service_role;

comment on column public.acuerdo_pago.fecha is
  'Fecha en que la entidad se comprometió a pagar, acordada con la Coordinación (HU-17, DA-42).';
