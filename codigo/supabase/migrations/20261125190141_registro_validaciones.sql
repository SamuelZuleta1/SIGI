-- ---------------------------------------------------------------------------
-- Auditoría de las HU (pendientes): validaciones del registro (HU-03) y fecha de nacimiento de las licencias (HU-12).
--
-- HU-03 — lo que el controlador ya valida, la base lo vuelve a comprobar (otro camino o una carrera no lo saltan):
--   * fecha de recepción: no futura (hoy en Colombia) y no anterior a la fecha de inicio (restricción);
--   * fecha de inicio: no anterior a hoy − 3 años (prescripción del reembolso, Ley 1438 de 2011, art. 28);
--     como la recepción no puede ser futura ni anterior al inicio, el inicio tampoco puede ser futuro;
--   * tipo coherente con la entidad: accidente y enfermedad laboral → ARL; los demás (enfermedad general,
--     accidente de tránsito y licencias) → EPS;
--   * sin duplicados: mismo colaborador, mismo tipo, misma fecha de inicio y mismos días (índice único);
--   * si el correo ya existe con otro nombre, no se usa en silencio el guardado: se rechaza (SG020) salvo que
--     quien registra confirme que es la misma persona (p_nombre_confirmado).
-- HU-12 — fecha_nacimiento (DA-13) se escribe al registrar una licencia y es obligatoria en ambas:
--   * no futura (en la función);
--   * paternidad: la licencia empieza entre el nacimiento y 30 días después (Ley 2114 de 2021);
--   * maternidad: empieza entre 2 semanas antes del nacimiento (preparto) y el día del nacimiento;
--   * las demás incapacidades no la tienen.
--
-- Códigos: SG020 nombre distinto sin confirmar · SG021 tipo y entidad incoherentes · SG022 fechas fuera de rango ·
-- SG023 fecha de nacimiento no válida · 23505 (incapacidad_sin_duplicados) duplicada.
-- SECURITY INVOKER (por defecto), search_path vacío; solo service_role la ejecuta.
-- ---------------------------------------------------------------------------

alter table public.incapacidad
  add constraint incapacidad_recepcion_desde_inicio check (fecha_recepcion >= fecha_inicio);

alter table public.incapacidad
  add constraint incapacidad_fecha_nacimiento_licencia check (
    case tipo
      when 'licencia_paternidad' then
        fecha_nacimiento is not null and fecha_inicio between fecha_nacimiento and fecha_nacimiento + 30
      when 'licencia_maternidad' then
        fecha_nacimiento is not null and fecha_inicio between fecha_nacimiento - 14 and fecha_nacimiento
      else fecha_nacimiento is null
    end
  );

-- También sirve a la búsqueda de duplicados del controlador (colaborador + tipo + fechas).
create unique index incapacidad_sin_duplicados
  on public.incapacidad (colaborador_id, tipo, fecha_inicio, dias_incapacidad);

drop function public.registrar_incapacidad(text, text, bigint, text, date, integer, date, uuid);

create function public.registrar_incapacidad(
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

  if p_fecha_nacimiento > v_hoy then
    raise exception 'Fecha de nacimiento futura' using errcode = 'SG023';
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

  begin
    insert into public.incapacidad
      (colaborador_id, entidad_id, tipo, fecha_inicio, dias_incapacidad, fecha_recepcion, fecha_nacimiento, creado_por)
    values
      (v_colaborador_id, p_entidad_id, p_tipo, p_fecha_inicio, p_dias, p_fecha_recepcion, p_fecha_nacimiento, p_creado_por)
    returning id into v_incapacidad_id;
  exception when check_violation then
    -- La única restricción que la función no comprueba antes es la ventana de la licencia (HU-12).
    raise exception 'Fecha de nacimiento no válida' using errcode = 'SG023';
  end;

  return v_incapacidad_id;
end;
$$;

revoke execute on function public.registrar_incapacidad(text, text, bigint, text, date, integer, date, uuid, date, boolean)
  from public, anon, authenticated;
grant execute on function public.registrar_incapacidad(text, text, bigint, text, date, integer, date, uuid, date, boolean)
  to service_role;

comment on constraint incapacidad_fecha_nacimiento_licencia on public.incapacidad is
  'HU-12: la licencia de paternidad empieza entre el nacimiento y 30 días después; la de maternidad, entre 14 días antes y el nacimiento; las demás no tienen fecha de nacimiento.';
