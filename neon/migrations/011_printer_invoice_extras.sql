-- Existing invoices keep their original fields and receive an empty extras list.
ALTER TABLE public.printer_sales
  ADD COLUMN IF NOT EXISTS extra_items jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(extra_items) = 'array');
