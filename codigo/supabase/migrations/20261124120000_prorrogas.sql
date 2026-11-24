-- ---------------------------------------------------------------------------
-- DA-50 (corregida 2026-11-24): prórrogas. Una prórroga es un certificado nuevo que continúa a otro (Decreto 1427 de
-- 2022): mismo colaborador y mismo tipo, empieza después de que termina el anterior y a más tardar 30 días después.
-- Los días del caso se acumulan para los tramos del reconocimiento (HU-21) y los hitos 90/120/150/180 (HU-12, HU-22 a
-- HU-24, HU-28). Cada certificado sigue su propio trámite (documentos, radicación, cobro, pago, conciliación, archivo).
--
-- Modelo: el caso es una cadena sin ramas (cada certificado tiene a lo sumo una prórroga; unique en prorroga_de).
--   * prorroga_de     el certificado que continúa (null = primero del caso).
--   * caso_id         el primero del caso (él mismo si no es prórroga). Agrupa la cadena.
--   * dias_previos    días del caso antes de este certificado; dias_acumulados = dias_previos + dias_incapacidad.
--   * tiene_prorroga  true cuando ya llegó su prórroga: deja de ser el certificado vigente del caso.
--   * fecha_dia_N     fecha real del día N del caso (N = 90, 120, 150, 180, 181), o null si el caso no llega a ese día
--                     con los certificados registrados. Exacta aunque haya interrupciones entre certificados: los días
--                     que caen en un certificado anterior se copian de él. Las usan las alertas, el monitoreo y las
--                     escrituras condicionadas (antes: fecha_inicio + N − 1, DA-49).
--   * El estado del monitoreo (concepto, falta, suspensión y su auditoría) pasa a la prórroga: el caso se monitorea en
--     su certificado vigente.
-- Todo lo derivado lo pone el trigger antes de insertar, así vale para cualquier inserción (también las de las pruebas).
-- Cambiar después la fecha o los días de un certificado que ya tiene prórroga no se propaga: SIGI no lo hace.
--
-- SECURITY INVOKER (por defecto): la función la ejecuta el servidor con la clave service role.
-- search_path vacío y nombres calificados. Solo service_role puede ejecutarla.
-- ---------------------------------------------------------------------------

alter table public.incapacidad
  add column prorroga_de     bigint unique references public.incapacidad (id) on delete restrict,
  add column caso_id         bigint references public.incapacidad (id) on delete restrict,
  add column dias_previos    integer not null default 0 check (dias_previos >= 0),
  add column dias_acumulados integer generated always as (dias_previos + dias_incapacidad) stored,
  add column tiene_prorroga  boolean not null default false,
  add column fecha_dia_90    date,
  add column fecha_dia_120   date,
  add column fecha_dia_150   date,
  add column fecha_dia_180   date,
  add column fecha_dia_181   date,
  add constraint incapacidad_prorroga_de_otra check (prorroga_de is null or prorroga_de <> id),
  add constraint incapacidad_dias_previos_prorroga check ((prorroga_de is null) = (dias_previos = 0));

-- prorroga_de ya tiene índice (unique). caso_id se consulta por caso.
create index incapacidad_caso_id_idx on public.incapacidad (caso_id);
-- El monitoreo lista los casos vigentes de más de 90 días (DA-47).
create index incapacidad_vigentes_prolongadas_idx on public.incapacidad (dias_acumulados) where not tiene_prorroga;

-- Fecha del día N del caso para la fila `nueva`, con su anterior (o null si es la primera).
create function public.fecha_dia_caso(p_n integer, p_fecha_inicio date, p_dias integer, p_previos integer, p_fecha_anterior date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_n <= p_previos then p_fecha_anterior
    when p_n <= p_previos + p_dias then p_fecha_inicio + (p_n - p_previos - 1)
    else null
  end;
$$;

create function public.incapacidad_derivados_del_caso()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_anterior public.incapacidad%rowtype;
begin
  if new.prorroga_de is null then
    new.caso_id := new.id;
    new.dias_previos := 0;
  else
    select * into strict v_anterior from public.incapacidad where id = new.prorroga_de;
    new.caso_id := v_anterior.caso_id;
    new.dias_previos := v_anterior.dias_acumulados;
    if tg_op = 'INSERT' then
      -- El caso se monitorea en su certificado vigente: el estado del monitoreo pasa a la prórroga.
      new.concepto := v_anterior.concepto;
      new.falta_concepto := v_anterior.falta_concepto;
      new.pago_suspendido := v_anterior.pago_suspendido;
      new.fecha_concepto := v_anterior.fecha_concepto;
      new.concepto_por := v_anterior.concepto_por;
      new.fecha_falta_concepto := v_anterior.fecha_falta_concepto;
      new.falta_concepto_por := v_anterior.falta_concepto_por;
      new.fecha_suspension := v_anterior.fecha_suspension;
      new.suspension_por := v_anterior.suspension_por;
    end if;
  end if;
  new.fecha_dia_90  := public.fecha_dia_caso(90,  new.fecha_inicio, new.dias_incapacidad, new.dias_previos, v_anterior.fecha_dia_90);
  new.fecha_dia_120 := public.fecha_dia_caso(120, new.fecha_inicio, new.dias_incapacidad, new.dias_previos, v_anterior.fecha_dia_120);
  new.fecha_dia_150 := public.fecha_dia_caso(150, new.fecha_inicio, new.dias_incapacidad, new.dias_previos, v_anterior.fecha_dia_150);
  new.fecha_dia_180 := public.fecha_dia_caso(180, new.fecha_inicio, new.dias_incapacidad, new.dias_previos, v_anterior.fecha_dia_180);
  new.fecha_dia_181 := public.fecha_dia_caso(181, new.fecha_inicio, new.dias_incapacidad, new.dias_previos, v_anterior.fecha_dia_181);
  return new;
end;
$$;

create trigger incapacidad_derivados_del_caso
  before insert or update of prorroga_de, fecha_inicio, dias_incapacidad on public.incapacidad
  for each row execute function public.incapacidad_derivados_del_caso();

-- Al llegar la prórroga, el anterior deja de ser el vigente.
create function public.incapacidad_marcar_prorrogada()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.incapacidad set tiene_prorroga = true where id = new.prorroga_de;
  return null;
end;
$$;

create trigger incapacidad_marcar_prorrogada
  after insert on public.incapacidad
  for each row when (new.prorroga_de is not null)
  execute function public.incapacidad_marcar_prorrogada();

-- Las filas que ya existen: cada una es el primero de su caso (dispara el trigger de derivados).
update public.incapacidad set fecha_inicio = fecha_inicio;

alter table public.incapacidad
  alter column caso_id set not null;

-- ---------------------------------------------------------------------------
-- DS-01: guardarIncapacidad de una prórroga (HU-03, DA-50). Toma colaborador, entidad y tipo del anterior, que se
-- bloquea para que dos prórrogas del mismo certificado no se crucen. Devuelve el id nuevo, o falla con:
--   SG010 el anterior no existe · SG011 ya tiene prórroga · SG012 es una licencia (no se prorroga)
--   SG013 la fecha de inicio no está entre el día siguiente al fin del anterior y 30 días después
-- ---------------------------------------------------------------------------
create function public.registrar_prorroga(
  p_anterior        bigint,
  p_fecha_inicio    date,
  p_dias            integer,
  p_fecha_recepcion date,
  p_creado_por      uuid
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_anterior public.incapacidad%rowtype;
  v_fin      date;
  v_id       bigint;
begin
  select * into v_anterior from public.incapacidad where id = p_anterior for update;
  if not found then
    raise exception 'La incapacidad anterior no existe' using errcode = 'SG010';
  end if;
  if v_anterior.tiene_prorroga then
    raise exception 'La incapacidad ya tiene prórroga' using errcode = 'SG011';
  end if;
  if v_anterior.tipo in ('licencia_maternidad', 'licencia_paternidad') then
    raise exception 'Una licencia no tiene prórroga' using errcode = 'SG012';
  end if;
  v_fin := v_anterior.fecha_inicio + (v_anterior.dias_incapacidad - 1);
  if p_fecha_inicio <= v_fin or p_fecha_inicio > v_fin + 31 then
    raise exception 'La prórroga debe empezar entre el día siguiente al fin de la anterior y 30 días después'
      using errcode = 'SG013';
  end if;

  insert into public.incapacidad
    (colaborador_id, entidad_id, tipo, fecha_inicio, dias_incapacidad, fecha_recepcion, prorroga_de, creado_por)
  values
    (v_anterior.colaborador_id, v_anterior.entidad_id, v_anterior.tipo, p_fecha_inicio, p_dias, p_fecha_recepcion,
     p_anterior, p_creado_por)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.registrar_prorroga(bigint, date, integer, date, uuid) from public, anon, authenticated;
grant execute on function public.registrar_prorroga(bigint, date, integer, date, uuid) to service_role;
revoke execute on function public.fecha_dia_caso(integer, date, integer, integer, date) from public, anon, authenticated;
revoke execute on function public.incapacidad_derivados_del_caso() from public, anon, authenticated;
revoke execute on function public.incapacidad_marcar_prorrogada() from public, anon, authenticated;
