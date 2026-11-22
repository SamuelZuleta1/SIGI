-- ---------------------------------------------------------------------------
-- HU-19.CA1 (DS-08: trasladarACartera(id, motivo) → guardarTraslado(motivo); DA-44): trasladar la incapacidad a
-- Cartera y Jurídica con el motivo que escribe el auxiliar (DA-14: los «180 días» son solo un motivo).
--   * Se agrega la fecha del traslado (`fecha_traslado`), siempre junto con el motivo, para la línea de tiempo.
--   * La función solo traslada si la incapacidad sigue «cobrada», sin dar de baja (DA-18) y sin trasladar antes
--     (un solo traslado por incapacidad: `motivo_traslado` es único). Que haya demora y cuántos requerimientos
--     hay (advertir y permitir, DA-14) lo resuelve el Control. La fila se bloquea (FOR UPDATE) frente a un pago.
-- Devuelve true si trasladó; false si el estado no lo permite, ya estaba trasladada o no existe.
--
-- SECURITY INVOKER (por defecto): la ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarla.
-- ---------------------------------------------------------------------------
alter table public.incapacidad
  add column fecha_traslado date;

alter table public.incapacidad
  add constraint incapacidad_traslado_completo check ((motivo_traslado is null) = (fecha_traslado is null)),
  add constraint incapacidad_motivo_traslado_largo check (motivo_traslado is null or char_length(motivo_traslado) between 3 and 500);

create function public.trasladar_a_cartera(
  p_incapacidad_id bigint,
  p_motivo         text,
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
    and decision is distinct from 'dar_de_baja'
    and motivo_traslado is null
  for update;

  if not found then
    return false;
  end if;

  update public.incapacidad
  set motivo_traslado = p_motivo,
      fecha_traslado  = p_fecha
  where id = p_incapacidad_id;

  return true;
end;
$$;

revoke execute on function public.trasladar_a_cartera(bigint, text, date)
  from public, anon, authenticated;
grant execute on function public.trasladar_a_cartera(bigint, text, date)
  to service_role;

comment on column public.incapacidad.fecha_traslado is
  'Fecha en que se trasladó a Cartera y Jurídica, junto con motivo_traslado (HU-19, DA-44).';
