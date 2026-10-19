export interface PlanEntitlementCountDto {
  planId: string;
  planCode: string;
  planName: string;
  includedStores: number;
  includedTerminals: number;
  activeSubscriptions: number;
}

export interface PlansEntitlementsResponseDto {
  plans: PlanEntitlementCountDto[];
  totals: {
    activeSubscriptions: number;
    merchantsAtStoreCapacity: number;
    merchantsAtTerminalCapacity: number;
    expiredSubscriptions: number;
  };
  generatedAt: string;
}
