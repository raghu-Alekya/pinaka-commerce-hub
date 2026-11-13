import { DataSource } from 'typeorm';

/** Terminal mappings live in store_pos_configurations (terminal_register_mapping). */
export async function ensurePosTerminalMappingSchema(_db: DataSource): Promise<void> {
  return;
}
