-- La plataforma de Supabase instala en la nube el disparador de eventos `ensure_rls`,
-- que activa RLS en cada tabla nueva de `public` mediante la función `public.rls_auto_enable()`
-- (SECURITY DEFINER). Esa función quedó expuesta en /rest/v1/rpc a `anon` y `authenticated`.
-- Los disparadores de eventos se ejecutan sin necesidad de EXECUTE del rol que ejecuta el DDL,
-- así que se revoca el permiso sin afectar su funcionamiento.
-- Condicional: en Supabase local la función no existe.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
