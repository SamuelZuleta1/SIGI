-- ---------------------------------------------------------------------------
-- HU-26 / HU-29 (DA-56, DA-59): deshacer una conciliación ya no deja un archivo preparado con un pago sin conciliar.
-- Si el correo de una conciliación falla, deshacer_conciliacion libera sus pagos; si mientras tanto una de esas
-- incapacidades alcanzó a prepararse para archivo (y aún no se envió a Gestión Documental), también se le quita la
-- marca: su pago vuelve a estar sin conciliar y debe conciliarse de nuevo antes de archivarla (DA-11).
-- La fila de la incapacidad se bloquea antes de liberar los pagos, en el mismo orden que preparar_archivo.
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

  update public.incapacidad
  set fecha_archivo_preparado = null,
      archivo_preparado_por   = null
  where id in (select incapacidad_id from public.pago where conciliacion_id = p_id)
    and fecha_archivo_preparado is not null
    and not enviada_a_gestion_documental;

  update public.pago set conciliado = false, conciliacion_id = null where conciliacion_id = p_id;
  update public.pago_consignado set conciliacion_id = null where conciliacion_id = p_id;
  delete from public.conciliacion where id = p_id;
end;
$$;

revoke execute on function public.deshacer_conciliacion(bigint) from public, anon, authenticated;
grant execute on function public.deshacer_conciliacion(bigint) to service_role;
