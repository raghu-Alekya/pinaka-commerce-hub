export interface AdministrationOverviewResponseDto {
  merchants: { total_count: number; active_count: number; inactive_count: number };
  stores: { total_count: number; active_count: number; inactive_count: number };
  users_and_access: { total_users_count: number; active_users_count: number; role_assignments_count: number };
  subscriptions: { total_count: number; active_count: number; expired_count: number };
}
