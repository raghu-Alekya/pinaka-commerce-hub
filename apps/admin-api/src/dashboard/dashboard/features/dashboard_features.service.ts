import {
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DashboardFiltersDto } from '../dto/dashboard_filters.dto';
import { DashboardFeaturesResponseDto } from './dto/dashboard_features_response.dto';

interface FeatureRecord {
  id?: string;
  name?: string;
  feature_code?: string;
  status?: string;
}

interface PlanRecord {
  status?: string;
  is_deleted?: boolean;
  included_features?: string[];
  enabled_entitlement_feature_ids?: string[];
}

export function summarizeFeatures(features: FeatureRecord[], plans: PlanRecord[]) {
  const eligibleFeatures = features.filter((feature) => feature.feature_code?.trim());
  const active = eligibleFeatures.filter((feature) => feature.status?.toUpperCase() === 'ACTIVE').length;
  const inactive = eligibleFeatures.filter((feature) => feature.status?.toUpperCase() === 'INACTIVE').length;
  const aliasesToCode = new Map<string, string>();
  for (const feature of eligibleFeatures) {
    const code = feature.feature_code!.trim().toLowerCase();
    for (const alias of [feature.id, feature.name, feature.feature_code]) {
      if (alias?.trim()) aliasesToCode.set(alias.trim().toLowerCase(), code);
    }
  }
  const included = new Set<string>();

  for (const plan of plans) {
    if (plan.status?.toUpperCase() !== 'ACTIVE' || plan.is_deleted === true) continue;
    for (const token of [
      ...(plan.included_features ?? []),
      ...(plan.enabled_entitlement_feature_ids ?? []),
    ]) {
      const code = aliasesToCode.get(token.trim().toLowerCase());
      if (code) included.add(code);
    }
  }

  return {
    total_features_count: eligibleFeatures.length,
    active_features_count: active,
    inactive_features_count: inactive,
    included_in_plans_count: included.size,
    not_included_in_any_plan_count: eligibleFeatures.length - included.size,
  };
}

@Injectable()
export class DashboardFeaturesService {
  async get_features(
    _filters: DashboardFiltersDto,
    authorization?: string,
  ): Promise<DashboardFeaturesResponseDto> {
    const baseUrl = (process.env.MERCHANT_SERVICE_URL || 'http://localhost:3003').replace(/\/$/, '');

    try {
      const [featureResponse, planResponse] = await Promise.all([
        fetch(`${baseUrl}/api/v1/features`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${baseUrl}/api/v1/plans`, {
          signal: AbortSignal.timeout(5000),
          headers: authorization ? { authorization } : undefined,
        }),
      ]);
      if (!featureResponse.ok) {
        throw new ServiceUnavailableException('Merchant-service feature read failed.');
      }
      if (planResponse.status === 401 || planResponse.status === 403) {
        throw new UnauthorizedException('A valid bearer token is required to read plans from merchant-service.');
      }
      if (!planResponse.ok) {
        throw new ServiceUnavailableException('Merchant-service plan read failed.');
      }
      const [featurePayload, planPayload] = await Promise.all([
        featureResponse.json() as Promise<{ features?: FeatureRecord[] }>,
        planResponse.json() as Promise<{ plans?: PlanRecord[] }>,
      ]);
      if (!Array.isArray(featurePayload.features) || !Array.isArray(planPayload.plans)) {
        throw new Error('Merchant service returned an invalid feature or plan response');
      }

      return {
        success: true,
        data: summarizeFeatures(featurePayload.features, planPayload.plans),
        last_updated: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        message: 'Feature dashboard data is unavailable because the merchant-service data provider could not be reached.',
      });
    }
  }
}
