-- ---------------------------------------------------------------------------
-- HU-07.CA2 (DA-29): cuando se registran documentos, la incapacidad «vuelve a quedar lista
-- para verificarse» (EST-02: vuelve a «Documentos registrados»):
--   * documentacion_completa = null  (por verificar; false = faltantes notificados, true = verificada)
--   * archivado_digital = false      (si ya estaba archivada, la verificación se reabre)
-- Se conservan faltantes y fecha_aviso_faltantes como registro del último aviso (HU-08, HU-12).
--
-- Misma firma que en 20261117123131_registro_atomico.sql: `create or replace` conserva los
-- permisos (solo service_role). SECURITY INVOKER, search_path vacío y nombres calificados.
-- Documentos, original pendiente y reapertura quedan en la misma transacción.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_documentos(
  p_incapacidad_id     bigint,
  p_documentos         jsonb,
  p_original_pendiente boolean,
  p_creado_por         uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_documentos) is distinct from 'array' or jsonb_array_length(p_documentos) = 0 then
    raise exception 'Se necesita al menos un documento' using errcode = '22023';
  end if;

  insert into public.documento (incapacidad_id, tipo, archivo, creado_por)
  select p_incapacidad_id, d.tipo, d.archivo, p_creado_por
  from jsonb_to_recordset(p_documentos) as d (tipo text, archivo text);

  update public.incapacidad
  set original_pendiente     = original_pendiente or p_original_pendiente,
      documentacion_completa = null,
      archivado_digital      = false
  where id = p_incapacidad_id;
end;
$$;
