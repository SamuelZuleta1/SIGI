-- ---------------------------------------------------------------------------
-- HU-30 (DS-13: registrarEnvioArchivo(id) → guardarEnvio(id); DA-60). Fin del ciclo de la incapacidad.
--   * El envío de los documentos físicos a Gestión Documental queda guardado con quién y cuándo (DA-23):
--     fecha_envio_archivo, envio_archivo_por. enviada_a_gestion_documental (esquema inicial) es true solo con la fecha.
--   * registrar_envio_archivo lo registra solo si la incapacidad está pagada, con el archivo preparado (HU-29) y aún
--     sin enviar. Es un único UPDATE condicionado: dos registros a la vez no pisan la fecha ni el usuario, y si a la
--     vez deshacer_conciliacion quita la marca de archivo preparado, uno espera al otro (bloqueo de la fila).
--     Devuelve true si lo registró.
--   * Una vez enviada no se deshace: deshacer_archivo_preparado y deshacer_conciliacion ya no tocan las enviadas.
--
-- SECURITY INVOKER (por defecto): la ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarla.
-- ---------------------------------------------------------------------------
alter table public.incapacidad
  add column fecha_envio_archivo timestamptz,
  add column envio_archivo_por   uuid references public.usuario (id);

alter table public.incapacidad
  add constraint incapacidad_envio_auditado check (
    (fecha_envio_archivo is null) = (envio_archivo_por is null)
  ),
  add constraint incapacidad_envio_con_fecha check (
    enviada_a_gestion_documental = (fecha_envio_archivo is not null)
  );

create index incapacidad_envio_archivo_por_idx on public.incapacidad (envio_archivo_por);

comment on column public.incapacidad.fecha_envio_archivo is
  'Cuándo se registró la entrega de los documentos físicos a Gestión Documental: fin del ciclo (HU-30, DA-60).';
comment on column public.incapacidad.envio_archivo_por is 'Quién registró el envío a Gestión Documental (HU-30, DA-23).';

create function public.registrar_envio_archivo(
  p_incapacidad_id bigint,
  p_por            uuid
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.incapacidad
  set enviada_a_gestion_documental = true,
      fecha_envio_archivo          = now(),
      envio_archivo_por            = p_por
  where id = p_incapacidad_id
    and estado = 'pagada'
    and fecha_archivo_preparado is not null
    and not enviada_a_gestion_documental;

  return found;
end;
$$;

revoke execute on function public.registrar_envio_archivo(bigint, uuid) from public, anon, authenticated;
grant execute on function public.registrar_envio_archivo(bigint, uuid) to service_role;
