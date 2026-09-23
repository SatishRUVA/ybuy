-- Enable Realtime delivery for new messages so open conversations update live.
alter publication supabase_realtime add table public.messages;
