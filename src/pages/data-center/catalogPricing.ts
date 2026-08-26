export type CatalogPricingStatus = 'loading' | 'unconfigured' | 'invalid' | 'ready' | 'error';

export type CatalogPricingItem = {
  type: 'labour' | 'equipment' | 'material' | 'subcontractor';
  sourceEntityId?: string;
  budgetItemId: string;
  sourceRateId?: string;
  labourClassId?: string;
  divisionId?: string;
  divisionName?: string;
  name: string;
  description?: string;
  unit: string;
  costRate: number | null;
  directCostPerUnit?: number | null;
  divisionOverheadRecoveryPerUnit?: number | null;
  recoveredCostPerUnit?: number | null;
  targetMarginPct?: number | null;
  profit?: number | null;
  calculatedRate?: number | null;
  customRate?: number | null;
  estimateRate?: number | null;
  sellRate?: number | null;
  pricingAvailable: boolean;
  pricingReason?: string;
};

export type CatalogPricingPayload = {
  ok: boolean;
  status: Exclude<CatalogPricingStatus, 'loading' | 'error'>;
  pricingBudgetId?: string;
  budget?: { id: string; name: string };
  catalog?: {
    labour: CatalogPricingItem[];
    equipment: CatalogPricingItem[];
    materials: CatalogPricingItem[];
    subcontractors: CatalogPricingItem[];
  };
  labourDiagnostics?: {
    hasPlannedLabour: boolean;
    plannedEmployeeCount: number;
    hasAssignedProductiveLabour: boolean;
    unassignedEmployees: Array<{ employeeId: string; employeeName: string }>;
  };
  error?: string;
};