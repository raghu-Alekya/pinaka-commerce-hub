-- Repair audit triggers after TypeORM converts snake_case columns to camelCase.
-- Safe to rerun; preserves existing records and trigger attachments.
CREATE OR REPLACE FUNCTION public.pch_master_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    row_data jsonb := to_jsonb(NEW);
    old_data jsonb := to_jsonb(OLD);
    audit_values jsonb := '{}'::jsonb;
    column_name text;
BEGIN
    FOREACH column_name IN ARRAY ARRAY['created_at', 'createdAt'] LOOP
        IF row_data ? column_name THEN
            audit_values := audit_values || jsonb_build_object(column_name, old_data -> column_name);
        END IF;
    END LOOP;
    FOREACH column_name IN ARRAY ARRAY['updated_at', 'updatedAt'] LOOP
        IF row_data ? column_name THEN
            audit_values := audit_values || jsonb_build_object(column_name, clock_timestamp());
        END IF;
    END LOOP;
    NEW := jsonb_populate_record(NEW, audit_values);
    RETURN NEW;
END;
$$;
