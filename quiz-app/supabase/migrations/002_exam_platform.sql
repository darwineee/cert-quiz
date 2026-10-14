-- ============================================================
-- Migration 002: Exam Platform Schema
-- Drops legacy tables and creates the new multi-exam platform.
-- ============================================================

-- 1. Drop legacy tables
DROP TABLE IF EXISTS exam_history CASCADE;
DROP TABLE IF EXISTS exam_answers CASCADE;
DROP TABLE IF EXISTS question_history CASCADE;
DROP TABLE IF EXISTS exam_sessions CASCADE;
DROP TABLE IF EXISTS questions CASCADE;

-- ============================================================
-- 2. Create new tables
-- ============================================================

-- Certifications (SAA, SAP, etc.)
CREATE TABLE certifications (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Exam Sets (grouped by source)
CREATE TABLE exam_sets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id TEXT NOT NULL REFERENCES certifications(id),
  name             TEXT NOT NULL,
  source           TEXT NOT NULL,
  description      TEXT,
  sort_order       INT DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Individual Exams
CREATE TABLE exams (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_set_id     UUID NOT NULL REFERENCES exam_sets(id),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  question_count  INT NOT NULL DEFAULT 65,
  time_limit_min  INT NOT NULL DEFAULT 130,
  pass_percent    INT NOT NULL DEFAULT 72,
  sort_order      INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Questions (belong to a specific exam)
CREATE TABLE questions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id          UUID NOT NULL REFERENCES exams(id),
  number           INT NOT NULL,
  stem             TEXT NOT NULL,
  stem_html        TEXT,
  options          JSONB NOT NULL,
  correct          TEXT[] NOT NULL,
  explanation_html TEXT,
  section          TEXT,
  image_urls       TEXT[],
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE(exam_id, number)
);

-- User Exam Attempts (supports save/resume)
CREATE TABLE exam_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exam_id         UUID NOT NULL REFERENCES exams(id),
  status          TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress', 'completed')),
  shuffle_seed    INT,
  timer_enabled   BOOLEAN DEFAULT true,
  current_index   INT DEFAULT 0,
  answers         JSONB DEFAULT '{}'::jsonb,
  revealed        JSONB DEFAULT '[]'::jsonb,
  time_remaining  INT,
  question_order  INT[],
  score           INT,
  completed_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 3. Create indexes
-- ============================================================

CREATE INDEX idx_exam_sets_cert   ON exam_sets(certification_id);
CREATE INDEX idx_exams_set        ON exams(exam_set_id);
CREATE INDEX idx_questions_exam   ON questions(exam_id);
CREATE INDEX idx_attempts_user    ON exam_attempts(user_id);
CREATE INDEX idx_attempts_exam    ON exam_attempts(exam_id);
CREATE INDEX idx_attempts_status  ON exam_attempts(user_id, status);

-- ============================================================
-- 4. Row Level Security
-- ============================================================

-- Public read for catalog tables
ALTER TABLE certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Certifications are publicly readable"
  ON certifications FOR SELECT USING (true);

ALTER TABLE exam_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Exam sets are publicly readable"
  ON exam_sets FOR SELECT USING (true);

ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Exams are publicly readable"
  ON exams FOR SELECT USING (true);

ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Questions are publicly readable"
  ON questions FOR SELECT USING (true);

-- Users can only manage their own attempts
ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own exam attempts"
  ON exam_attempts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 5. updated_at trigger for exam_attempts
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_exam_attempts_updated_at
  BEFORE UPDATE ON exam_attempts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
