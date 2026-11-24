-- SIGI — esquema inicial (T-00b)
-- Fuente: diagrama de clases CL-01 + decisiones de la auditoría
-- (docs/auditoria/03_decisiones.md) + docs/plan_desarrollo.md §4.
--
-- Convenciones:
--   * snake_case; la capa de Persistencia convierte al camelCase del diseño (P-E).
--   * Claves primarias bigint identity; fechas date; momentos timestamptz; dinero numeric(14,2).
--   * Cada clave foránea tiene su índice.
--   * creado_por / creado_en en todas las tablas (DA-23).
--   * RLS activado y SIN políticas: el navegador no puede leer nada.
--     Solo el servidor accede, con la clave service role (F1 §2.6).

-- ---------------------------------------------------------------------------
-- usuario (tabla técnica, DA-02)
-- ---------------------------------------------------------------------------
create table public.usuario (
  id        uuid primary key references auth.users (id) on delete cascade,
  correo    text not null unique,
  rol       text not null
            check (rol in ('receptor', 'lider', 'auxiliar', 'contabilidad', 'cartera')),
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- colaborador (CL-01; correo: DA-04)
-- ---------------------------------------------------------------------------
create table public.colaborador (
  id         bigint generated always as identity primary key,
  nombre     text not null check (length(btrim(nombre)) > 0),
  correo     text not null unique,
  creado_por uuid not null references public.usuario (id),
  creado_en  timestamptz not null default now()
);
create index colaborador_creado_por_idx on public.colaborador (creado_por);

-- ---------------------------------------------------------------------------
-- entidad (CL-01; procedimiento §5.2.1; P-C)
-- creado_por admite null: las entidades se cargan con el seed (DA-03).
-- ---------------------------------------------------------------------------
create table public.entidad (
  id                           bigint generated always as identity primary key,
  nombre                       text not null unique,
  tipo                         text not null check (tipo in ('EPS', 'ARL', 'AFP')),
  plazo_transcripcion          interval,
  plazo_transcripcion_transito interval,
  permite_transcripcion_digital boolean not null default true,
  creado_por                   uuid references public.usuario (id),
  creado_en                    timestamptz not null default now()
);
create index entidad_creado_por_idx on public.entidad (creado_por);

-- ---------------------------------------------------------------------------
-- incapacidad (clase central de CL-01; DA-10, DA-13)
-- id = idIncapacidad. estado null = registrada (EST-01).
-- ---------------------------------------------------------------------------
create table public.incapacidad (
  id                           bigint generated always as identity primary key,
  colaborador_id               bigint not null references public.colaborador (id),
  entidad_id                   bigint not null references public.entidad (id),
  tipo                         text not null check (tipo in (
                                 'enfermedad_general', 'accidente_laboral', 'enfermedad_laboral',
                                 'accidente_transito', 'licencia_maternidad', 'licencia_paternidad')),
  fecha_inicio                 date not null,
  dias_incapacidad             integer not null check (dias_incapacidad > 0),
  fecha_recepcion              date not null,
  estado                       text check (estado in ('transcrita', 'cobrada', 'rechazada', 'pagada')),
  original_pendiente           boolean not null default false,
  documentacion_completa       boolean,
  archivado_digital            boolean not null default false,
  faltantes                    text[] not null default '{}',
  fecha_aviso_faltantes        date,
  segundo_llamado              boolean not null default false,
  tiempo_pago                  text,
  causal_rechazo               text,
  motivo_traslado              text,
  decision                     text check (decision in ('recuperar', 'dar_de_baja')),
  concepto                     text,
  falta_concepto               boolean not null default false,
  pago_suspendido              boolean not null default false,
  ibc                          numeric(14,2) check (ibc >= 0),
  valor_empresa                numeric(14,2) check (valor_empresa >= 0),
  valor_eps                    numeric(14,2) check (valor_eps >= 0),
  tramite_pension              boolean not null default false,
  fecha_nacimiento             date,
  enviada_a_gestion_documental boolean not null default false,
  creado_por                   uuid not null references public.usuario (id),
  creado_en                    timestamptz not null default now()
);
create index incapacidad_colaborador_id_idx on public.incapacidad (colaborador_id);
create index incapacidad_entidad_id_idx     on public.incapacidad (entidad_id);
create index incapacidad_creado_por_idx     on public.incapacidad (creado_por);
create index incapacidad_estado_idx         on public.incapacidad (estado);
create index incapacidad_fecha_inicio_idx   on public.incapacidad (fecha_inicio);

-- ---------------------------------------------------------------------------
-- documento (composición 1..*; tipos: DA-06). archivo = ruta en Storage.
-- ---------------------------------------------------------------------------
create table public.documento (
  id             bigint generated always as identity primary key,
  incapacidad_id bigint not null references public.incapacidad (id) on delete cascade,
  tipo           text not null check (tipo in (
                   'soporte_incapacidad', 'epicrisis', 'historia_clinica', 'furips',
                   'certificado_nacido_vivo', 'registro_civil', 'documento_identidad')),
  archivo        text not null,
  creado_por     uuid not null references public.usuario (id),
  creado_en      timestamptz not null default now()
);
create index documento_incapacidad_id_idx on public.documento (incapacidad_id);
create index documento_creado_por_idx     on public.documento (creado_por);

-- ---------------------------------------------------------------------------
-- reemplazo (0..1 por incapacidad; DA-22). El unique ya crea el índice de la FK.
-- ---------------------------------------------------------------------------
create table public.reemplazo (
  id             bigint generated always as identity primary key,
  incapacidad_id bigint not null unique references public.incapacidad (id) on delete cascade,
  reemplazo      text not null check (length(btrim(reemplazo)) > 0),
  creado_por     uuid not null references public.usuario (id),
  creado_en      timestamptz not null default now()
);
create index reemplazo_creado_por_idx on public.reemplazo (creado_por);

-- ---------------------------------------------------------------------------
-- radicacion (0..*). evidencia = ruta en Storage (P-D).
-- ---------------------------------------------------------------------------
create table public.radicacion (
  id             bigint generated always as identity primary key,
  incapacidad_id bigint not null references public.incapacidad (id) on delete cascade,
  radicado       text not null,
  evidencia      text,
  creado_por     uuid not null references public.usuario (id),
  creado_en      timestamptz not null default now()
);
create index radicacion_incapacidad_id_idx on public.radicacion (incapacidad_id);
create index radicacion_creado_por_idx     on public.radicacion (creado_por);

-- ---------------------------------------------------------------------------
-- requerimiento (0..*)
-- ---------------------------------------------------------------------------
create table public.requerimiento (
  id             bigint generated always as identity primary key,
  incapacidad_id bigint not null references public.incapacidad (id) on delete cascade,
  fundamentos    text not null,
  creado_por     uuid not null references public.usuario (id),
  creado_en      timestamptz not null default now()
);
create index requerimiento_incapacidad_id_idx on public.requerimiento (incapacidad_id);
create index requerimiento_creado_por_idx     on public.requerimiento (creado_por);

-- ---------------------------------------------------------------------------
-- seguimiento (0..*). evidencia = ruta en Storage (P-D).
-- ---------------------------------------------------------------------------
create table public.seguimiento (
  id             bigint generated always as identity primary key,
  incapacidad_id bigint not null references public.incapacidad (id) on delete cascade,
  evidencia      text,
  creado_por     uuid not null references public.usuario (id),
  creado_en      timestamptz not null default now()
);
create index seguimiento_incapacidad_id_idx on public.seguimiento (incapacidad_id);
create index seguimiento_creado_por_idx     on public.seguimiento (creado_por);

-- ---------------------------------------------------------------------------
-- acuerdo_pago (0..*)
-- ---------------------------------------------------------------------------
create table public.acuerdo_pago (
  id             bigint generated always as identity primary key,
  incapacidad_id bigint not null references public.incapacidad (id) on delete cascade,
  fecha          date not null,
  valor          numeric(14,2) not null check (valor > 0),
  creado_por     uuid not null references public.usuario (id),
  creado_en      timestamptz not null default now()
);
create index acuerdo_pago_incapacidad_id_idx on public.acuerdo_pago (incapacidad_id);
create index acuerdo_pago_creado_por_idx     on public.acuerdo_pago (creado_por);

-- ---------------------------------------------------------------------------
-- pago (0..*; conciliado: DA-11; fecha escrita por el auxiliar: DA-16)
-- ---------------------------------------------------------------------------
create table public.pago (
  id             bigint generated always as identity primary key,
  incapacidad_id bigint not null references public.incapacidad (id) on delete cascade,
  valor          numeric(14,2) not null check (valor > 0),
  fecha_pago     date not null,
  conciliado     boolean not null default false,
  creado_por     uuid not null references public.usuario (id),
  creado_en      timestamptz not null default now()
);
create index pago_incapacidad_id_idx on public.pago (incapacidad_id);
create index pago_creado_por_idx     on public.pago (creado_por);

-- ---------------------------------------------------------------------------
-- pago_consignado (Entidad 1 → 0..*). colaborador es texto, como en CL-01 (P-B).
-- ---------------------------------------------------------------------------
create table public.pago_consignado (
  id           bigint generated always as identity primary key,
  entidad_id   bigint not null references public.entidad (id),
  colaborador  text not null,
  dias_pagados integer not null check (dias_pagados > 0),
  valor        numeric(14,2) not null check (valor > 0),
  creado_por   uuid not null references public.usuario (id),
  creado_en    timestamptz not null default now()
);
create index pago_consignado_entidad_id_idx on public.pago_consignado (entidad_id);
create index pago_consignado_creado_por_idx on public.pago_consignado (creado_por);

-- ---------------------------------------------------------------------------
-- conciliacion (Entidad 1 → 0..*)
-- ---------------------------------------------------------------------------
create table public.conciliacion (
  id                bigint generated always as identity primary key,
  entidad_id        bigint not null references public.entidad (id),
  detalle           jsonb not null default '[]'::jsonb,
  saldos_pendientes jsonb not null default '[]'::jsonb,
  creado_por        uuid not null references public.usuario (id),
  creado_en         timestamptz not null default now()
);
create index conciliacion_entidad_id_idx on public.conciliacion (entidad_id);
create index conciliacion_creado_por_idx on public.conciliacion (creado_por);

-- ---------------------------------------------------------------------------
-- reporte (contenido: DA-21). periodo = AAAA-MM.
-- ---------------------------------------------------------------------------
create table public.reporte (
  id         bigint generated always as identity primary key,
  tipo       text not null check (tipo in ('ausentismo', 'prolongadas')),
  periodo    text not null check (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  contenido  jsonb not null default '[]'::jsonb,
  creado_por uuid not null references public.usuario (id),
  creado_en  timestamptz not null default now()
);
create index reporte_creado_por_idx on public.reporte (creado_por);

-- ---------------------------------------------------------------------------
-- Seguridad: RLS activado sin políticas + privilegios mínimos.
-- anon y authenticated (lo que usaría un navegador) no reciben nada;
-- solo service_role, que es la clave que usa el servidor.
-- ---------------------------------------------------------------------------
alter table public.usuario         enable row level security;
alter table public.colaborador     enable row level security;
alter table public.entidad         enable row level security;
alter table public.incapacidad     enable row level security;
alter table public.documento       enable row level security;
alter table public.reemplazo       enable row level security;
alter table public.radicacion      enable row level security;
alter table public.requerimiento   enable row level security;
alter table public.seguimiento     enable row level security;
alter table public.acuerdo_pago    enable row level security;
alter table public.pago            enable row level security;
alter table public.pago_consignado enable row level security;
alter table public.conciliacion    enable row level security;
alter table public.reporte         enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Storage: bucket privado «documentos» (RNF-03, HU-02).
-- Sin políticas en storage.objects: solo el servidor (service role) accede.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos', 'documentos', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;
