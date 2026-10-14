-- 1. Questions table (stores the quiz questions, public read access)
CREATE TABLE questions (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  options JSONB NOT NULL,
  answer TEXT[] NOT NULL,
  categories TEXT[] DEFAULT '{}',
  domains TEXT[] DEFAULT '{}',
  explanation TEXT,
  images TEXT[] DEFAULT '{}'
);

-- Create GIN indexes for array filtering
CREATE INDEX idx_questions_categories ON questions USING GIN (categories);
CREATE INDEX idx_questions_domains ON questions USING GIN (domains);

-- 2. Exam sessions table (replaces localStorage exam_state)
CREATE TABLE exam_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config JSONB NOT NULL,
  questions JSONB NOT NULL,  -- ExamQuestion[] array
  status TEXT NOT NULL DEFAULT 'in-progress' CHECK (status IN ('in-progress', 'completed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  time_spent_seconds INTEGER,
  score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exam_sessions_user ON exam_sessions(user_id);
CREATE INDEX idx_exam_sessions_status ON exam_sessions(user_id, status);

-- 3. Question history table (per-user per-question stats)
CREATE TABLE question_history (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  times_seen INTEGER NOT NULL DEFAULT 0,
  times_correct INTEGER NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

CREATE INDEX idx_question_history_user ON question_history(user_id);

-- 4. Row Level Security
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Questions are publicly readable" ON questions FOR SELECT USING (true);

ALTER TABLE exam_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own exam sessions" ON exam_sessions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

ALTER TABLE question_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own question history" ON question_history FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
