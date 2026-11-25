-- ---------------------------------------------------------------------------
-- HU-29 / DA-59 (auditoría, B4): la eliminación de la epicrisis queda guardada aparte del archivo preparado.
--   * eliminarEpicrisis (DA-12) la marca antes de borrar los archivos y las filas: borrar no se deshace.
--   * deshacer_archivo_preparado (si falla el correo a Gestión Documental) y deshacer_conciliacion quitan
--     fecha_archivo_preparado, pero no esta marca: la verificación sigue mostrando la epicrisis como eliminada y
--     no como faltante, y no se vuelve a recibir (CAR-11).
-- Columna nueva, nula y sin valor por defecto: no reescribe la tabla.
-- ---------------------------------------------------------------------------
alter table public.incapacidad
  add column epicrisis_eliminada_en timestamptz;

comment on column public.incapacidad.epicrisis_eliminada_en is
  'Cuándo se eliminó la epicrisis al preparar el archivo (DA-12, DA-59). No se borra al deshacer la preparación.';
