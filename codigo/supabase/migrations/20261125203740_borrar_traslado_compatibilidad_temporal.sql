-- ---------------------------------------------------------------------------
-- Fin de la compatibilidad temporal (DA-70). 20261125202022_traslado_compatibilidad_temporal recreó la firma de
-- 3 parámetros de trasladar_a_cartera para la versión que estaba desplegada antes del PR #4. Esa versión ya no está
-- en producción (Vercel desplegó df9d7f8): solo queda la firma con causal (20261125193654_traslado_causales).
-- ---------------------------------------------------------------------------
drop function public.trasladar_a_cartera(bigint, text, date);
