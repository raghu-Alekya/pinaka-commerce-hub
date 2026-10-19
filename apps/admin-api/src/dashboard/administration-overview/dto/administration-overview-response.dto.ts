export class MerchantsOverviewDto {
  total_count!: number;
  active_count!: number;
  onboarding_count!: number;
  inactive_count!: number;
  growth_percentage!: number;
}

export class StoresOverviewDto {
  total_count!: number;
  active_count!: number;
  pending_count!: number;
  inactive_count!: number;
  growth_percentage!: number;
}

export class EmployeesOverviewDto {
  total_count!: number;
  without_roles_count!: number;
  locked_count!: number;
  growth_percentage!: number;
}

export class SubscriptionsOverviewDto {
  active_count!: number;
  expiring_count!: number;
  payment_pending_count!: number;
  growth_percentage!: number;
}

export class FeaturesOverviewDto {
  total_count!: number;
  active_count!: number;
  inactive_count!: number;
}

export class AdministrationOverviewDataDto {
  merchants!: MerchantsOverviewDto;
  stores!: StoresOverviewDto;
  employees!: EmployeesOverviewDto;
  subscriptions!: SubscriptionsOverviewDto;
  features!: FeaturesOverviewDto;
}

export class AdministrationOverviewResponseDto {
  success!: boolean;
  data!: AdministrationOverviewDataDto;
}
