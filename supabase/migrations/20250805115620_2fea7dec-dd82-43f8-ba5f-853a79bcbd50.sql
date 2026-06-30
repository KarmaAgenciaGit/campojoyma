-- Add audio_base64 column to work_reports table
ALTER TABLE public.work_reports 
ADD COLUMN audio_base64 TEXT;

-- Add indexes for better performance
CREATE INDEX idx_work_reports_date ON public.work_reports(date);
CREATE INDEX idx_work_reports_project_id ON public.work_reports(project_id);

-- Add foreign key constraint for project_id if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints 
                 WHERE constraint_name = 'work_reports_project_id_fkey') THEN
    ALTER TABLE public.work_reports 
    ADD CONSTRAINT work_reports_project_id_fkey 
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
  END IF;
END $$;