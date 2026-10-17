import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DashboardFiltersDto } from '../dto/dashboard_filters.dto';
import { PlatformHealthResponseDto } from './dto/platform_health_response.dto';

interface HealthSourceResponse {
  devices: { active_count: number; inactive_count: number; eligible_count: number };
  stores_synchronized: { synchronized_count: number; eligible_count: number };
  pos_configuration: { completed_count: number; eligible_count: number };
}

@Injectable()
export class PlatformHealthService {
  async get_platform_health(
    filters: DashboardFiltersDto,
    authorization?: string,
  ): Promise<PlatformHealthResponseDto> {
    const baseUrl = (process.env.MERCHANT_SERVICE_URL || 'http://localhost:3003').replace(/\/$/, '');
    const query = new URLSearchParams();
    if (filters.merchant_id) query.set('merchant_id', filters.merchant_id);
    if (filters.store_id) query.set('store_id', filters.store_id);
    const suffix = query.size ? `?${query.toString()}` : '';

    try {
      const response = await fetch(`${baseUrl}/api/v1/dashboard/platform-health/source-metrics${suffix}`, {
        signal: AbortSignal.timeout(5000),
        headers: authorization ? { authorization } : undefined,
      });
      if (response.status === 401 || response.status === 403) {
        throw new UnauthorizedException('A valid bearer token is required to read Platform Health data from merchant-service.');
      }
      if (!response.ok) {
        throw new ServiceUnavailableException('Merchant-service Platform Health data read failed.');
      }
      const source = await response.json() as HealthSourceResponse;
      if (!source?.devices || !source?.stores_synchronized || !source?.pos_configuration) {
        throw new Error('Invalid merchant-service Platform Health response');
      }

      const activePct = source.devices.eligible_count
        ? Math.round((source.devices.active_count / source.devices.eligible_count) * 100)
        : null;

      return {
        devices: {
          online_count: null,
          active_count: source.devices.active_count,
          inactive_count: source.devices.inactive_count,
          total_count: source.devices.eligible_count,
          active_pct: activePct,
          status: 'available',
          definition: 'Temporary active-device metric based on RecordStatus; this does not verify online connectivity.',
        },
        stores_synchronized: {
          ...source.stores_synchronized,
          status: 'available',
          status_definition: 'For this dashboard, synchronized means the existing WooCommerce website connection status is CONNECTED. This does not measure product/order sync job freshness or success.',
        },
        pos_configuration: {
          status: 'available',
          ...source.pos_configuration,
          definition: 'A store is complete when all nine named POS configuration categories have a saved store_pos_configurations record. This checks category presence, not field-level validity.',
        },
        platform_health_score_pct: null,
        platform_health_score_status: 'unavailable',
        platform_health_score_reason: 'No overall score formula has been agreed.',
        last_updated: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        message: 'Platform Health data is unavailable because the merchant-service data provider could not be reached.',
      });
    }
  }
}
