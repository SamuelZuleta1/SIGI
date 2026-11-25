-- ---------------------------------------------------------------------------
-- Auditoría de las HU (DA-70, consecuencia de DA-67/DA-68): una rechazada ya trasladada a Cartera y Jurídica no se
-- radica de nuevo. Antes, registrar_radicacion la devolvía a «transcrita» con el traslado puesto y el cobro seguía por
-- dos vías a la vez. Misma firma y mismos permisos; solo se agrega la condición `motivo_traslado is null`.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_radicacion(
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
    and (estado is null or estado = 'rechazada')
    and motivo_traslado is null;

  if not found then
    return null;
  end if;

  insert into public.radicacion (incapacidad_id, radicado, evidencia, creado_por)
  values (p_incapacidad_id, p_radicado, p_evidencia, p_creado_por)
  returning id into v_radicacion_id;

  return v_radicacion_id;
end;
$$;
