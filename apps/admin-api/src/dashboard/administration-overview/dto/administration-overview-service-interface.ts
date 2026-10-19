import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { connectPostgres } from '@pinaka-delivery-hub/database';
import { MerchantEntity } from '../../../../../merchant-service/src/entities/merchant.entity';
import { StoreEntity } from '../../../../../merchant-service/src/entities/store.entity';
import { EmployeeEntity } from '../../../../../merchant-service/src/entities/employee.entity';
import { EmployeeStoreEntity } from '../../../../../merchant-service/src/entities/employee-store.entity';
import { EmployeeStoreRoleEntity } from '../../../../../merchant-service/src/entities/employee-store-role.entity';
import { SubscriptionEntity } from '../../../../../merchant-service/src/entities/subscription.entity';
import { PlanEntity } from '../../../../../merchant-service/src/entities/plan.entity';
import { FeatureEntity } from '../../../../../merchant-service/src/entities/feature.entity';
import { AdministrationOverviewQueryDto } from './administration-overview-query.dto';
import {
  AdministrationOverviewResponseDto,
  EmployeesOverviewDto,
  FeaturesOverviewDto,
  MerchantsOverviewDto,
  StoresOverviewDto,
  SubscriptionsOverviewDto,
} from './administration-overview-response.dto';

interface DateBounds {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
}

@Injectable()
export class AdministrationOverviewService
  implements OnModuleInit, OnModuleDestroy
{
  private dataSource!: DataSource;
  private hasEmployeeLockedCol = false;
  private hasEmployeeLockedAtCol = false;
  private hasUserStatusCol = false;

  async onModuleInit(): Promise<void> {
    try {
      this.dataSource = await connectPostgres(
        'Admin API PostgreSQL',
        [],
        { synchronize: false },
      );

      // Dynamically detect available columns for lock status
      const empCols = await this.dataSource.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees'`,
      );
      const empColNames = (empCols || []).map((c: { column_name: string }) =>
        String(c.column_name).toLowerCase(),
      );
      this.hasEmployeeLockedCol =
        empColNames.includes('is_locked') || empColNames.includes('locked');
      this.hasEmployeeLockedAtCol = empColNames.includes('locked_at');

      const userCols = await this.dataSource.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'`,
      );
      const userColNames = (userCols || []).map((c: { column_name: string }) =>
        String(c.column_name).toLowerCase(),
      );
      this.hasUserStatusCol = userColNames.includes('status');
    } catch (error) {
      console.error(
        'Failed to initialize Admin API database connection:',
        error,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  private ensureConnected(): void {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new ServiceUnavailableException(
        'Database connection is not initialized',
      );
    }
  }

  private resolveDateBounds(dateRange?: string): DateBounds {
    const now = new Date();
    const range = (dateRange || 'last_30_days').toLowerCase();

    let currentStart: Date;
    const currentEnd = now;
    let previousStart: Date;
    let previousEnd: Date;

    switch (range) {
      case 'today': {
        currentStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          0,
          0,
          0,
          0,
        );
        const durationMs = 24 * 60 * 60 * 1000;
        previousStart = new Date(currentStart.getTime() - durationMs);
        previousEnd = currentStart;
        break;
      }
      case 'last_7_days': {
        const durationMs = 7 * 24 * 60 * 60 * 1000;
        currentStart = new Date(now.getTime() - durationMs);
        previousStart = new Date(currentStart.getTime() - durationMs);
        previousEnd = currentStart;
        break;
      }
      case 'last_90_days':
      case 'quarter': {
        const durationMs = 90 * 24 * 60 * 60 * 1000;
        currentStart = new Date(now.getTime() - durationMs);
        previousStart = new Date(currentStart.getTime() - durationMs);
        previousEnd = currentStart;
        break;
      }
      case 'last_365_days':
      case 'year': {
        const durationMs = 365 * 24 * 60 * 60 * 1000;
        currentStart = new Date(now.getTime() - durationMs);
        previousStart = new Date(currentStart.getTime() - durationMs);
        previousEnd = currentStart;
        break;
      }
      case 'last_30_days':
      case 'month':
      default: {
        const durationMs = 30 * 24 * 60 * 60 * 1000;
        currentStart = new Date(now.getTime() - durationMs);
        previousStart = new Date(currentStart.getTime() - durationMs);
        previousEnd = currentStart;
        break;
      }
    }

    return { currentStart, currentEnd, previousStart, previousEnd };
  }

  private calculateGrowth(current: number, previous: number): number {
    if (previous <= 0) {
      return current > 0 ? 100 : 0;
    }
    const growth = ((current - previous) / previous) * 100;
    return Math.round(growth * 10) / 10;
  }

  async getMerchantsOverview(
    bounds: DateBounds,
    filters: AdministrationOverviewQueryDto,
  ): Promise<MerchantsOverviewDto> {
    const params: unknown[] = [
      bounds.currentStart,
      bounds.currentEnd,
      bounds.previousStart,
      bounds.previousEnd,
    ];

    let whereClause = '';
    if (filters.merchant_id) {
      params.push(filters.merchant_id);
      whereClause += ` AND (m.id::text = $${params.length} OR m.merchant_id = $${params.length} OR m.merchant_code = $${params.length})`;
    }
    if (filters.store_id) {
      params.push(filters.store_id);
      whereClause += ` AND EXISTS (SELECT 1 FROM public.stores s WHERE s.merchant_id = m.id AND (s.id::text = $${params.length} OR s.store_code = $${params.length}))`;
    }

    const query = `
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE upper(m.status::text) = 'ACTIVE')::int AS active_count,
        COUNT(*) FILTER (
          WHERE upper(m.status::text) = 'PENDING'
             OR (upper(m.status::text) <> 'INACTIVE' AND upper(COALESCE(m.onboarding_step, '')) LIKE '%STEP%')
        )::int AS onboarding_count,
        COUNT(*) FILTER (WHERE upper(m.status::text) = 'INACTIVE')::int AS inactive_count,
        COUNT(*) FILTER (WHERE m.created_at >= $1 AND m.created_at <= $2)::int AS current_period_count,
        COUNT(*) FILTER (WHERE m.created_at >= $3 AND m.created_at < $4)::int AS previous_period_count
      FROM public.merchants m
      WHERE (m.is_deleted = false OR m.is_deleted IS NULL)${whereClause}
    `;

    const [row] = await this.dataSource.query(query, params);
    const total = Number(row?.total_count || 0);
    const active = Number(row?.active_count || 0);
    const onboarding = Number(row?.onboarding_count || 0);
    const inactive = Number(row?.inactive_count || 0);
    const current = Number(row?.current_period_count || 0);
    const previous = Number(row?.previous_period_count || 0);

    return {
      total_count: total,
      active_count: active,
      onboarding_count: onboarding,
      inactive_count: inactive,
      growth_percentage: this.calculateGrowth(current, previous),
    };
  }

  async getStoresOverview(
    bounds: DateBounds,
    filters: AdministrationOverviewQueryDto,
  ): Promise<StoresOverviewDto> {
    const params: unknown[] = [
      bounds.currentStart,
      bounds.currentEnd,
      bounds.previousStart,
      bounds.previousEnd,
    ];

    let whereClause = '';
    if (filters.merchant_id) {
      params.push(filters.merchant_id);
      whereClause += ` AND s.merchant_id IN (SELECT id FROM public.merchants WHERE id::text = $${params.length} OR merchant_id = $${params.length} OR merchant_code = $${params.length})`;
    }
    if (filters.store_id) {
      params.push(filters.store_id);
      whereClause += ` AND (s.id::text = $${params.length} OR s.store_code = $${params.length})`;
    }

    const query = `
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE upper(s.status::text) = 'ACTIVE')::int AS active_count,
        COUNT(*) FILTER (WHERE upper(s.status::text) = 'PENDING')::int AS pending_count,
        COUNT(*) FILTER (WHERE upper(s.status::text) = 'INACTIVE')::int AS inactive_count,
        COUNT(*) FILTER (WHERE s.created_at >= $1 AND s.created_at <= $2)::int AS current_period_count,
        COUNT(*) FILTER (WHERE s.created_at >= $3 AND s.created_at < $4)::int AS previous_period_count
      FROM public.stores s
      WHERE (s.is_deleted = false OR s.is_deleted IS NULL)${whereClause}
    `;

    const [row] = await this.dataSource.query(query, params);
    const total = Number(row?.total_count || 0);
    const active = Number(row?.active_count || 0);
    const pending = Number(row?.pending_count || 0);
    const inactive = Number(row?.inactive_count || 0);
    const current = Number(row?.current_period_count || 0);
    const previous = Number(row?.previous_period_count || 0);

    return {
      total_count: total,
      active_count: active,
      pending_count: pending,
      inactive_count: inactive,
      growth_percentage: this.calculateGrowth(current, previous),
    };
  }

  async getEmployeesOverview(
    bounds: DateBounds,
    filters: AdministrationOverviewQueryDto,
  ): Promise<EmployeesOverviewDto> {
    const params: unknown[] = [
      bounds.currentStart,
      bounds.currentEnd,
      bounds.previousStart,
      bounds.previousEnd,
    ];

    let whereClause = '';
    if (filters.merchant_id) {
      params.push(filters.merchant_id);
      whereClause += ` AND e.merchant_id IN (SELECT id FROM public.merchants WHERE id::text = $${params.length} OR merchant_id = $${params.length} OR merchant_code = $${params.length})`;
    }
    if (filters.store_id) {
      params.push(filters.store_id);
      whereClause += ` AND EXISTS (SELECT 1 FROM public.employee_stores es JOIN public.stores st ON st.id = es.store_id WHERE es.employee_id = e.id AND (st.id::text = $${params.length} OR st.store_code = $${params.length}))`;
    }

    let lockedCondition = 'FALSE';
    if (this.hasEmployeeLockedCol) {
      lockedCondition = '(e.is_locked = true)';
    } else if (this.hasEmployeeLockedAtCol) {
      lockedCondition = '(e.locked_at IS NOT NULL)';
    } else if (this.hasUserStatusCol) {
      lockedCondition = `EXISTS (SELECT 1 FROM public.users u WHERE u.id = e.user_id AND upper(u.status::text) = 'LOCKED')`;
    }

    const query = `
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM public.employee_stores es
            JOIN public.employee_store_roles esr ON esr.employee_store_id = es.id
            WHERE es.employee_id = e.id AND esr.role_id IS NOT NULL
          )
        )::int AS without_roles_count,
        COUNT(*) FILTER (WHERE ${lockedCondition})::int AS locked_count,
        COUNT(*) FILTER (WHERE e.created_at >= $1 AND e.created_at <= $2)::int AS current_period_count,
        COUNT(*) FILTER (WHERE e.created_at >= $3 AND e.created_at < $4)::int AS previous_period_count
      FROM public.employees e
      WHERE (e.is_deleted = false OR e.is_deleted IS NULL)${whereClause}
    `;

    const [row] = await this.dataSource.query(query, params);
    const total = Number(row?.total_count || 0);
    const withoutRoles = Number(row?.without_roles_count || 0);
    const locked = Number(row?.locked_count || 0);
    const current = Number(row?.current_period_count || 0);
    const previous = Number(row?.previous_period_count || 0);

    return {
      total_count: total,
      without_roles_count: withoutRoles,
      locked_count: locked,
      growth_percentage: this.calculateGrowth(current, previous),
    };
  }

  async getSubscriptionsOverview(
    bounds: DateBounds,
    filters: AdministrationOverviewQueryDto,
  ): Promise<SubscriptionsOverviewDto> {
    const params: unknown[] = [
      bounds.currentStart,
      bounds.currentEnd,
      bounds.previousStart,
      bounds.previousEnd,
    ];

    let whereClause = '';
    if (filters.plan_id) {
      params.push(filters.plan_id);
      whereClause += ` AND s.plan_id::text = $${params.length}`;
    }
    if (filters.merchant_id) {
      params.push(filters.merchant_id);
      whereClause += ` AND s.merchant_id IN (SELECT id FROM public.merchants WHERE id::text = $${params.length} OR merchant_id = $${params.length} OR merchant_code = $${params.length})`;
    }
    if (filters.store_id) {
      params.push(filters.store_id);
      whereClause += ` AND EXISTS (SELECT 1 FROM public.subscription_stores ss JOIN public.stores st ON st.id = ss.store_id WHERE ss.subscription_id = s.id AND (st.id::text = $${params.length} OR st.store_code = $${params.length}))`;
    }

    const query = `
      SELECT
        COUNT(*) FILTER (
          WHERE upper(s.status::text) IN ('ACTIVE', 'TRIAL', 'TRIALING')
            AND (s.cancelled_at IS NULL OR s.cancelled_at > CURRENT_TIMESTAMP)
        )::int AS active_count,
        COUNT(*) FILTER (
          WHERE upper(s.status::text) IN ('ACTIVE', 'TRIAL', 'TRIALING')
            AND (s.cancelled_at IS NULL OR s.cancelled_at > CURRENT_TIMESTAMP)
            AND (
              (s.renewal_date IS NOT NULL AND s.renewal_date >= CURRENT_DATE AND s.renewal_date <= CURRENT_DATE + interval '30 days')
              OR
              (s.trial_end_date IS NOT NULL AND s.trial_end_date >= CURRENT_DATE AND s.trial_end_date <= CURRENT_DATE + interval '30 days')
            )
        )::int AS expiring_count,
        COUNT(*) FILTER (
          WHERE upper(s.status::text) = 'PENDING'
        )::int AS payment_pending_count,
        COUNT(*) FILTER (
          WHERE upper(s.status::text) IN ('ACTIVE', 'TRIAL', 'TRIALING')
            AND s.created_at >= $1 AND s.created_at <= $2
        )::int AS current_period_count,
        COUNT(*) FILTER (
          WHERE upper(s.status::text) IN ('ACTIVE', 'TRIAL', 'TRIALING')
            AND s.created_at >= $3 AND s.created_at < $4
        )::int AS previous_period_count
      FROM public.subscriptions s
      WHERE (s.is_deleted = false OR s.is_deleted IS NULL)${whereClause}
    `;

    const [row] = await this.dataSource.query(query, params);
    const active = Number(row?.active_count || 0);
    const expiring = Number(row?.expiring_count || 0);
    const paymentPending = Number(row?.payment_pending_count || 0);
    const current = Number(row?.current_period_count || 0);
    const previous = Number(row?.previous_period_count || 0);

    return {
      active_count: active,
      expiring_count: expiring,
      payment_pending_count: paymentPending,
      growth_percentage: this.calculateGrowth(current, previous),
    };
  }

  async getFeaturesOverview(): Promise<FeaturesOverviewDto> {
    const query = `
      SELECT
        COUNT(*)::int AS total_count,
        COUNT(*) FILTER (WHERE upper(f.status::text) = 'ACTIVE')::int AS active_count,
        COUNT(*) FILTER (WHERE upper(f.status::text) = 'INACTIVE' OR upper(f.status::text) <> 'ACTIVE')::int AS inactive_count
      FROM public.features f
      WHERE (f.is_deleted = false OR f.is_deleted IS NULL)
    `;

    const [row] = await this.dataSource.query(query);
    const total = Number(row?.total_count || 0);
    const active = Number(row?.active_count || 0);
    const inactive = Number(row?.inactive_count || 0);

    return {
      total_count: total,
      active_count: active,
      inactive_count: inactive,
    };
  }

  async getOverview(
    query: AdministrationOverviewQueryDto,
  ): Promise<AdministrationOverviewResponseDto> {
    this.ensureConnected();

    const bounds = this.resolveDateBounds(query.date_range);

    const [merchants, stores, employees, subscriptions, features] =
      await Promise.all([
        this.getMerchantsOverview(bounds, query),
        this.getStoresOverview(bounds, query),
        this.getEmployeesOverview(bounds, query),
        this.getSubscriptionsOverview(bounds, query),
        this.getFeaturesOverview(),
      ]);

    return {
      success: true,
      data: {
        merchants,
        stores,
        employees,
        subscriptions,
        features,
      },
    };
  }
}
