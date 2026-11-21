-- ---------------------------------------------------------------------------
-- HU-15 (DS-06/07/08: registrarPago → actualizarEstado(pagada) → guardarPago(valor, fechaPago);
-- DA-08, DA-16, DA-40): guardar el pago y poner la incapacidad en «pagada», en una sola transacción.
--   * Solo desde «cobrada» o «pagada» (DA-08: después de un pago se pueden registrar más).
--     Desde registrada, transcrita o rechazada no hay transición en EST-01.
--   * El update condicionado va primero: bloquea la fila mientras se inserta el pago.
-- Devuelve el id del pago, o null si el estado no lo permite o la incapacidad no existe.
--
-- SECURITY INVOKER (por defecto): la ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarla.
-- ---------------------------------------------------------------------------
create function public.registrar_pago(
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
    and estado in ('cobrada', 'pagada');

  if not found then
    return null;
  end if;

  insert into public.pago (incapacidad_id, valor, fecha_pago, creado_por)
  values (p_incapacidad_id, p_valor, p_fecha_pago, p_creado_por)
  returning id into v_pago_id;

  return v_pago_id;
end;
$$;

revoke execute on function public.registrar_pago(bigint, numeric, date, uuid)
  from public, anon, authenticated;
grant execute on function public.registrar_pago(bigint, numeric, date, uuid)
  to service_role;

-- Una incapacidad pagada viene de una cobrada: conserva su tiempo de pago (HU-13, DA-38).
alter table public.incapacidad
  add constraint incapacidad_pagada_con_tiempo check (estado is distinct from 'pagada' or tiempo_pago is not null);

comment on column public.pago.fecha_pago is
  'Fecha en que la entidad pagó, escrita por el auxiliar (DA-16); no futura ni anterior al inicio (DA-40).';
