export interface PlatformHealthResponseDto {
  devices: {
    online_count: null;
    active_count: number;
    inactive_count: number;
    total_count: number;
    active_pct: number | null;
    status: 'available';
    definition: string;
  };
  stores_synchronized: {
    synchronized_count: number;
    eligible_count: number;
    status: 'available';
    status_definition: string;
  };
  pos_configuration: {
    status: 'available';
    definition: string;
    completed_count: number;
    eligible_count: number;
  };
  platform_health_score_pct: null;
  platform_health_score_status: 'unavailable';
  platform_health_score_reason: string;
  last_updated: string;
}
