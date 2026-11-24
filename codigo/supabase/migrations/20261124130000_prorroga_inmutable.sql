-- ---------------------------------------------------------------------------
-- DA-50: la cadena de un caso no se desarma después de registrada. Los datos derivados de una prórroga (días
-- previos y fechas de los días 90/120/150/180/181) se copian del certificado anterior al insertarla, así que:
--   * un certificado que ya tiene prórroga no cambia su fecha de inicio ni sus días (la prórroga quedaría con datos
--     viejos);
--   * prorroga_de no cambia después de insertar (una prórroga no se reasigna a otro caso).
-- Falla con SG014 y no cambia nada. SIGI no tiene pantallas que hagan esos cambios: esto protege la base.
--
-- Corre antes que incapacidad_derivados_del_caso (los triggers de una tabla se ejecutan por orden de nombre).
-- SECURITY INVOKER, search_path vacío.
-- ---------------------------------------------------------------------------
create function public.incapacidad_cadena_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.prorroga_de is distinct from old.prorroga_de then
    raise exception 'Una prórroga no cambia de certificado anterior' using errcode = 'SG014';
  end if;
  if old.tiene_prorroga
     and (new.fecha_inicio is distinct from old.fecha_inicio or new.dias_incapacidad is distinct from old.dias_incapacidad) then
    raise exception 'Un certificado con prórroga no cambia su fecha de inicio ni sus días' using errcode = 'SG014';
  end if;
  return new;
end;
$$;

create trigger incapacidad_cadena_inmutable
  before update of prorroga_de, fecha_inicio, dias_incapacidad on public.incapacidad
  for each row execute function public.incapacidad_cadena_inmutable();

revoke execute on function public.incapacidad_cadena_inmutable() from public, anon, authenticated;
