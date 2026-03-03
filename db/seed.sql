-- Local-only seed data (NO real HN / PDPA-safe)
-- Dates are YYYY-MM-DD

INSERT INTO ipd_stays (hn, ward, admit_date, discharge_date, los, stay_type) VALUES
('DUMMY-001', 'MED',  '2026-03-01', '2026-03-03', 2, 'admit'),
('DUMMY-002', 'MED',  '2026-03-02', '',           0, 'admit'),
('DUMMY-003', 'SURG', '2026-03-02', '2026-03-03', 1, 'admit'),
('DUMMY-004', 'ICU',  '2026-03-03', '',           0, 'admit');

INSERT INTO discharge_plans (
  ipd_stay_id, hn, ward, fit_discharge_date, actual_discharge_date, delay_days, delay_reason, delay_detail
) VALUES
(1, 'DUMMY-001', 'MED',  '2026-03-02', '2026-03-03', 1, 'admin', 'paperwork'),
(3, 'DUMMY-003', 'SURG', '2026-03-03', '2026-03-03', 0, '', '');

