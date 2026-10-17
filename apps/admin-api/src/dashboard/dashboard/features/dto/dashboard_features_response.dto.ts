export interface DashboardFeaturesResponseDto {
  success: true;
  data: {
    total_features_count: number;
    active_features_count: number;
    inactive_features_count: number;
    included_in_plans_count: number;
    not_included_in_any_plan_count: number;
  };
  last_updated: string;
}
