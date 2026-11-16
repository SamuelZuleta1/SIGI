-- SIGI — datos iniciales (T-00c, DA-03)
-- Entidades y plazos de transcripción: Procedimiento de Incapacidades §5.2.1.
-- SOS y Sanitas exigen la transcripción por correo (no digital).
-- Salud Total: los accidentes de tránsito se transcriben en 15 días (P-C).

insert into public.entidad
  (nombre, tipo, plazo_transcripcion, plazo_transcripcion_transito, permite_transcripcion_digital)
values
  ('Salud Total', 'EPS', interval '12 months', interval '15 days', true),
  ('Nueva EPS',   'EPS', interval '12 months', null,               true),
  ('SOS',         'EPS', interval '12 months', null,               false),
  ('Sanitas',     'EPS', interval '3 years',   null,               false),
  ('SURA EPS',    'EPS', interval '150 days',  null,               true),
  ('Asmet Salud', 'EPS', interval '12 months', null,               true),
  ('ARL SURA',    'ARL', interval '12 months', null,               true)
on conflict (nombre) do nothing;
