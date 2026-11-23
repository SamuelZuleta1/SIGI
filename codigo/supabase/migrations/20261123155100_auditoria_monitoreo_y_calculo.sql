-- ---------------------------------------------------------------------------
-- DA-23 (auditoría mínima) para HU-21 a HU-24: cada registro guarda quién lo hizo y cuándo.
--   * Concepto de rehabilitación (HU-22): fecha_concepto, concepto_por.
--   * Falta del concepto (HU-23): fecha_falta_concepto, falta_concepto_por. Se conservan cuando después se
--     registra el concepto (la falta queda resuelta, pero la constancia de que se avisó sigue ahí).
--   * Cálculo del reconocimiento (HU-21, DA-53): fecha_calculo, calculo_por (el del último cálculo).
--   * Suspensión del pago (HU-24): fecha_suspension, suspension_por.
-- Los checks exigen que el dato, su fecha y su usuario vayan siempre juntos (como incapacidad_decision_completa).
-- Las FK a usuario llevan índice. La tabla ya tiene RLS activado y sin políticas: solo la usa el servidor con la
-- clave service role.
-- ---------------------------------------------------------------------------
alter table public.incapacidad
  add column fecha_concepto       timestamptz,
  add column concepto_por         uuid references public.usuario (id),
  add column fecha_falta_concepto timestamptz,
  add column falta_concepto_por   uuid references public.usuario (id),
  add column fecha_calculo        timestamptz,
  add column calculo_por          uuid references public.usuario (id),
  add column fecha_suspension     timestamptz,
  add column suspension_por       uuid references public.usuario (id);

alter table public.incapacidad
  add constraint incapacidad_concepto_auditado check (
    (concepto is null) = (fecha_concepto is null) and (fecha_concepto is null) = (concepto_por is null)
  ),
  add constraint incapacidad_falta_concepto_auditada check (
    (fecha_falta_concepto is null) = (falta_concepto_por is null) and (not falta_concepto or fecha_falta_concepto is not null)
  ),
  add constraint incapacidad_calculo_auditado check (
    (ibc is null) = (fecha_calculo is null) and (fecha_calculo is null) = (calculo_por is null)
  ),
  add constraint incapacidad_suspension_auditada check (
    pago_suspendido = (fecha_suspension is not null) and (fecha_suspension is null) = (suspension_por is null)
  );

create index incapacidad_concepto_por_idx       on public.incapacidad (concepto_por);
create index incapacidad_falta_concepto_por_idx on public.incapacidad (falta_concepto_por);
create index incapacidad_calculo_por_idx        on public.incapacidad (calculo_por);
create index incapacidad_suspension_por_idx     on public.incapacidad (suspension_por);

comment on column public.incapacidad.fecha_concepto is 'Cuándo se registró el concepto de rehabilitación (HU-22, DA-23).';
comment on column public.incapacidad.concepto_por is 'Quién registró el concepto de rehabilitación (HU-22, DA-23).';
comment on column public.incapacidad.fecha_falta_concepto is 'Cuándo se registró la falta del concepto; se conserva si luego llega el concepto (HU-23, DA-23).';
comment on column public.incapacidad.falta_concepto_por is 'Quién registró la falta del concepto (HU-23, DA-23).';
comment on column public.incapacidad.fecha_calculo is 'Cuándo se hizo el último cálculo del reconocimiento (HU-21, DA-23, DA-53).';
comment on column public.incapacidad.calculo_por is 'Quién hizo el último cálculo del reconocimiento (HU-21, DA-23, DA-53).';
comment on column public.incapacidad.fecha_suspension is 'Cuándo se registró la suspensión del pago (HU-24, DA-23).';
comment on column public.incapacidad.suspension_por is 'Quién registró la suspensión del pago (HU-24, DA-23).';
