-- ---------------------------------------------------------------------------
-- HU-18.CA1 (DS-08: registrarRequerimiento(fundamentos) → guardarRequerimiento(fundamentos); DA-43): guardar un
-- requerimiento de cobro persuasivo con sus fundamentos.
--   * Solo si la incapacidad sigue «cobrada» y no se dio de baja (DA-05, DA-18); que además haya demora lo exige el
--     Control, que es quien conoce la fecha de hoy en Colombia (como registrar_acuerdo).
--   * La fila de la incapacidad se bloquea (FOR UPDATE) para no cruzarse con un pago o una baja simultáneos.
-- Devuelve el id del requerimiento, o null si el estado no lo permite o la incapacidad no existe.
-- Los fundamentos: entre 10 y 2000 caracteres (la misma regla que valida el Control, como defensa en profundidad).
--
-- SECURITY INVOKER (por defecto): la ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarla.
-- ---------------------------------------------------------------------------
alter table public.requerimiento
  add constraint requerimiento_fundamentos_largo
  check (char_length(fundamentos) between 10 and 2000);

create function public.registrar_requerimiento(
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
    and estado = 'cobrada'
    and decision is distinct from 'dar_de_baja'
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

revoke execute on function public.registrar_requerimiento(bigint, text, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_requerimiento(bigint, text, uuid)
  to service_role;

comment on column public.requerimiento.fundamentos is
  'Fundamentos del requerimiento de cobro persuasivo enviado a la entidad (HU-18, DA-43).';
