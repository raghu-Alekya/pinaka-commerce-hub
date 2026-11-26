function readBooleanFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`Invalid boolean environment value: ${value}`);
}

export function orderSchemaChangesOnStartup(): boolean {
  return readBooleanFlag(
    process.env.ORDER_SERVICE_SCHEMA_ON_STARTUP,
    true,
  );
}

export function orderDbRequired(): boolean {
  return readBooleanFlag(
    process.env.ORDER_SERVICE_REQUIRE_DB,
    process.env.NODE_ENV === 'production',
  );
}
