-- ---------------------------------------------------------------------------
-- HU-20.CA1 (DS-08: registrarDecision(decision) → guardarDecision(decision); DA-45): Cartera y Jurídica registra
-- su decisión sobre una incapacidad trasladada: recuperar el cobro o darlo de baja. El sistema solo la registra:
-- no cambia el estado (HU-20.CA2); la baja saca la acreencia de los pendientes de pago (DA-18).
--   * Se agrega la fecha de la decisión (`fecha_decision`), siempre junto con la decisión.
--   * La función solo registra si la incapacidad sigue «cobrada», fue trasladada y no tiene decisión
--     (una sola decisión por incapacidad). La fila se bloquea (FOR UPDATE) frente a un pago simultáneo.
-- Devuelve true si registró; false si el estado no lo permite, ya tenía decisión o no existe.
--
-- SECURITY INVOKER (por defecto): la ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarla.
-- ---------------------------------------------------------------------------
alter table public.incapacidad
  add column fecha_decision date;

alter table public.incapacidad
  add constraint incapacidad_decision_completa check ((decision is null) = (fecha_decision is null));

create function public.registrar_decision(
  p_incapacidad_id bigint,
  p_decision       text,
  p_fecha          date
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.incapacidad
  where id = p_incapacidad_id
    and estado = 'cobrada'
    and motivo_traslado is not null
    and decision is null
  for update;

  if not found then
    return false;
  end if;

  update public.incapacidad
  set decision       = p_decision,
      fecha_decision = p_fecha
  where id = p_incapacidad_id;

  return true;
end;
$$;

revoke execute on function public.registrar_decision(bigint, text, date)
  from public, anon, authenticated;
grant execute on function public.registrar_decision(bigint, text, date)
  to service_role;

comment on column public.incapacidad.fecha_decision is
  'Fecha en que Cartera y Jurídica registró su decisión, junto con decision (HU-20, DA-45).';
