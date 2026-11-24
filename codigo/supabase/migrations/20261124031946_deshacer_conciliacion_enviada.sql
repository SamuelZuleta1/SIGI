-- ---------------------------------------------------------------------------
-- HU-26 / HU-30 (DA-11, DA-56, DA-60): una conciliación con una incapacidad ya enviada a Gestión Documental no se
-- deshace. Antes, deshacer_conciliacion dejaba la enviada con sus marcas pero liberaba su pago: el ciclo quedaba
-- cerrado con un pago sin conciliar (contra DA-11). Ahora falla con error y no cambia nada (toda la función es una
-- transacción): la conciliación y sus enlaces se conservan.
--   * El servidor lo recibe como el fallo de «deshacer» de avisarODeshacer: responde 500 y dice que la conciliación
--     pudo quedar guardada sin el aviso a Contabilidad (es lo que pasó: quedó guardada).
--   * Código de error propio (SG001) para reconocerlo en las pruebas.
--   * Se mantiene el resto: bloquea las incapacidades en orden de id antes de mirar (mismo orden que preparar_archivo
--     y registrar_envio_archivo) y quita la marca de archivo preparado de las que aún no se enviaron.
--
-- SECURITY INVOKER (por defecto): la ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarla.
-- ---------------------------------------------------------------------------
create or replace function public.deshacer_conciliacion(p_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from public.incapacidad
  where id in (select incapacidad_id from public.pago where conciliacion_id = p_id)
  order by id
  for update;

  if exists (
    select 1
    from public.incapacidad
    where id in (select incapacidad_id from public.pago where conciliacion_id = p_id)
      and enviada_a_gestion_documental
  ) then
    raise exception 'La conciliación % incluye una incapacidad ya enviada a Gestión Documental: no se deshace', p_id
      using errcode = 'SG001';
  end if;

  update public.incapacidad
  set fecha_archivo_preparado = null,
      archivo_preparado_por   = null
  where id in (select incapacidad_id from public.pago where conciliacion_id = p_id)
    and fecha_archivo_preparado is not null;

  update public.pago set conciliado = false, conciliacion_id = null where conciliacion_id = p_id;
  update public.pago_consignado set conciliacion_id = null where conciliacion_id = p_id;
  delete from public.conciliacion where id = p_id;
end;
$$;

revoke execute on function public.deshacer_conciliacion(bigint) from public, anon, authenticated;
grant execute on function public.deshacer_conciliacion(bigint) to service_role;
