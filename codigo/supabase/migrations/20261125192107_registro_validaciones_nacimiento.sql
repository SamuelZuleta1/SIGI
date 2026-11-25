-- ---------------------------------------------------------------------------
-- Corrección de 20261125190141_registro_validaciones: registrar_incapacidad convertía cualquier violación de una
-- restricción CHECK en SG023 («fecha de nacimiento no válida»), también la de un tipo fuera de los 6. Ahora la
-- ventana de la licencia (HU-12) se comprueba antes del INSERT, como las demás reglas, y las otras violaciones llegan
-- con su código (23514). Misma firma, mismos permisos.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_incapacidad(
  p_nombre            text,
  p_correo            text,
  p_entidad_id        bigint,
  p_tipo              text,
  p_fecha_inicio      date,
  p_dias              integer,
  p_fecha_recepcion   date,
  p_creado_por        uuid,
  p_fecha_nacimiento  date    default null,
  p_nombre_confirmado boolean default false
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_hoy            date := (now() at time zone 'America/Bogota')::date;
  v_tipo_entidad   text;
  v_colaborador_id bigint;
  v_nombre         text;
  v_incapacidad_id bigint;
begin
  if p_fecha_recepcion > v_hoy or p_fecha_recepcion < p_fecha_inicio or p_fecha_inicio < (v_hoy - interval '3 years')::date then
    raise exception 'Fechas fuera de rango' using errcode = 'SG022';
  end if;

  select e.tipo into v_tipo_entidad from public.entidad e where e.id = p_entidad_id;
  if v_tipo_entidad is distinct from (case when p_tipo in ('accidente_laboral', 'enfermedad_laboral') then 'ARL' else 'EPS' end) then
    raise exception 'El tipo no corresponde a la entidad' using errcode = 'SG021';
  end if;

  -- HU-12: la misma regla que la restricción incapacidad_fecha_nacimiento_licencia, más «no futura».
  if p_fecha_nacimiento > v_hoy
     or (p_tipo = 'licencia_paternidad'
         and (p_fecha_nacimiento is null or p_fecha_inicio not between p_fecha_nacimiento and p_fecha_nacimiento + 30))
     or (p_tipo = 'licencia_maternidad'
         and (p_fecha_nacimiento is null or p_fecha_inicio not between p_fecha_nacimiento - 14 and p_fecha_nacimiento))
     or (p_tipo not in ('licencia_paternidad', 'licencia_maternidad') and p_fecha_nacimiento is not null) then
    raise exception 'Fecha de nacimiento no válida' using errcode = 'SG023';
  end if;

  -- «Insertar si no existe» sin choque entre registros simultáneos.
  insert into public.colaborador (nombre, correo, creado_por)
  values (p_nombre, p_correo, p_creado_por)
  on conflict (correo) do nothing;

  select c.id, c.nombre into strict v_colaborador_id, v_nombre
  from public.colaborador c
  where c.correo = p_correo;

  -- Mismo nombre = igual sin contar mayúsculas ni espacios repetidos o en los extremos.
  if not p_nombre_confirmado
     and lower(regexp_replace(btrim(v_nombre), '\s+', ' ', 'g')) <> lower(regexp_replace(btrim(p_nombre), '\s+', ' ', 'g')) then
    raise exception 'El correo ya es de otro nombre' using errcode = 'SG020';
  end if;

  insert into public.incapacidad
    (colaborador_id, entidad_id, tipo, fecha_inicio, dias_incapacidad, fecha_recepcion, fecha_nacimiento, creado_por)
  values
    (v_colaborador_id, p_entidad_id, p_tipo, p_fecha_inicio, p_dias, p_fecha_recepcion, p_fecha_nacimiento, p_creado_por)
  returning id into v_incapacidad_id;

  return v_incapacidad_id;
end;
$$;
