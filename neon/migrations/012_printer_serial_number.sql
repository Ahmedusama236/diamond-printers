-- Optional printer serial; prior invoices remain valid with NULL.
ALTER TABLE public.printer_sales ADD COLUMN IF NOT EXISTS serial_number text;
