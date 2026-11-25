-- ---------------------------------------------------------------------------
-- TEMPORAL — compatibilidad con la versión desplegada (rama main) mientras se despliega la auditoría de las HU.
-- 20261125193654_traslado_causales reemplazó trasladar_a_cartera(bigint, text, date) por la firma con causal; la app
-- en producción todavía llama a la de 3 parámetros y recibía un error 500 (PGRST202).
-- Esta firma aplica las reglas nuevas (DA-67): sin baja ni traslado previo y mínimo 2 requerimientos. Como el código
-- viejo no envía la causal, solo traslada cuando se puede deducir sin inventarla: una «cobrada» con 180 días o más
-- desde fecha_cobrada (causal 180_dias). En los demás casos devuelve false (la app vieja muestra que no se puede
-- trasladar). Se borra con una migración posterior en cuanto la nueva versión esté desplegada.
-- ---------------------------------------------------------------------------
create function public.trasladar_a_cartera(
  p_incapacidad_id bigint,
  p_motivo         text,
  p_fecha          date
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  return public.trasladar_a_cartera(p_incapacidad_id, '180_dias', p_motivo, p_fecha);
end;
$$;

revoke execute on function public.trasladar_a_cartera(bigint, text, date) from public, anon, authenticated;
grant execute on function public.trasladar_a_cartera(bigint, text, date) to service_role;
