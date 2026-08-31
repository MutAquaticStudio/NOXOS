BEGIN;

-- 1. Bổ sung các trường hóa lý số thực vào material_properties
ALTER TABLE material_properties
    ADD COLUMN IF NOT EXISTS vapor_pressure_mmhg numeric,
    ADD COLUMN IF NOT EXISTS boiling_point_c numeric,
    ADD COLUMN IF NOT EXISTS flash_point_c numeric,
    ADD COLUMN IF NOT EXISTS logp_val numeric,
    ADD COLUMN IF NOT EXISTS odor_threshold_ppb numeric,
    ADD COLUMN IF NOT EXISTS ifra_restricted boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS ifra_limits jsonb DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS eu_allergens jsonb DEFAULT '[]'::jsonb;

-- 2. Bảng Ma trận Dung môi Chuẩn (Carrier Solvents)
CREATE TABLE IF NOT EXISTS carrier_solvents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id uuid UNIQUE REFERENCES materials(id) ON DELETE RESTRICT,
    solvent_code text NOT NULL UNIQUE,
    solvent_name text NOT NULL,
    polarity text NOT NULL,
    is_standard_diluent boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);

-- 3. Bảng Lưu trữ Dữ liệu Khoa học Phân lập (Scientific Artifacts)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS scientific_artifacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id uuid NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
    structure_hash text NOT NULL,
    artifact_type text NOT NULL,
    model_family text NOT NULL,
    model_version text NOT NULL,
    taxonomy_source text NOT NULL DEFAULT 'OSMO',
    taxonomy_version text NOT NULL DEFAULT 'osmo_v1.2',
    embedding vector(256),
    predictions jsonb NOT NULL DEFAULT '{}'::jsonb,
    calibration_score numeric,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scientific_artifacts_mat ON scientific_artifacts(material_id);

COMMIT;
