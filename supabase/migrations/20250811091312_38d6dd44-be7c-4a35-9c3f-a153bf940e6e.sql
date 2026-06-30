-- Create table for daily audio summaries
CREATE TABLE public.daily_summaries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  audio_base64 TEXT NOT NULL,
  title TEXT,
  duration INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

-- Enable Row Level Security
ALTER TABLE public.daily_summaries ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "All authenticated users can view all daily summaries" 
ON public.daily_summaries 
FOR SELECT 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can insert daily summaries" 
ON public.daily_summaries 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can update daily summaries" 
ON public.daily_summaries 
FOR UPDATE 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can delete daily summaries" 
ON public.daily_summaries 
FOR DELETE 
USING (auth.role() = 'authenticated'::text);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_daily_summaries_updated_at
BEFORE UPDATE ON public.daily_summaries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();