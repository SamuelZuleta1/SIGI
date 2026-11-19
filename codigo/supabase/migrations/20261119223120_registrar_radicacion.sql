-- ---------------------------------------------------------------------------
-- HU-10 (DS-04: guardarRadicacion; DA-01, EST-01): registrar la radicación y poner la
-- incapacidad en «transcrita», en una sola transacción.
--   * Solo desde «registrada» (estado null) o «rechazada» (nueva radicación tras un rechazo,
--     HU-10.CA2, HU-14). Desde transcrita, cobrada o pagada no hay transición en EST-01 (DA-36).
--   * El update condicionado va primero: bloquea la fila, así dos registros simultáneos
--     no crean dos radicaciones.
-- Devuelve el id de la radicación, o null si el estado no lo permite o la incapacidad no existe.
--
-- SECURITY INVOKER (por defecto): la ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarla.
-- ---------------------------------------------------------------------------
create function public.registrar_radicacion(
  p_incapacidad_id bigint,
  p_radicado       text,
  p_evidencia      text,
  p_creado_por     uuid
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_radicacion_id bigint;
begin
  update public.incapacidad
  set estado = 'transcrita'
  where id = p_incapacidad_id
    and (estado is null or estado = 'rechazada');

  if not found then
    return null;
  end if;

  insert into public.radicacion (incapacidad_id, radicado, evidencia, creado_por)
  values (p_incapacidad_id, p_radicado, p_evidencia, p_creado_por)
  returning id into v_radicacion_id;

  return v_radicacion_id;
end;
$$;

revoke execute on function public.registrar_radicacion(bigint, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_radicacion(bigint, text, text, uuid)
  to service_role;

-- El número de radicado no puede quedar vacío ni ser desmedido (lo valida también el Control).
alter table public.radicacion
  add constraint radicacion_radicado_longitud check (char_length(btrim(radicado)) between 1 and 100);
