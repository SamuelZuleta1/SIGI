-- ---------------------------------------------------------------------------
-- HU-04 (auditoría, B3): el «original en físico pendiente» lo decide el último registro de documentos.
--   * Por correo (auxiliar, HU-04.CA2): p_original_pendiente = true  → queda pendiente.
--   * En recepción (personal receptor, HU-04.CA1): p_original_pendiente = false → el original se entregó en
--     físico y deja de estar pendiente.
-- Antes era `original_pendiente or p_original_pendiente`: una vez marcado, nunca volvía a false.
--
-- Misma firma que en 20261117130127_reabrir_verificacion.sql: `create or replace` conserva los permisos
-- (solo service_role). SECURITY INVOKER, search_path vacío y nombres calificados.
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
  set original_pendiente     = coalesce(p_original_pendiente, false),
      documentacion_completa = null,
      archivado_digital      = false
  where id = p_incapacidad_id;
end;
$$;
