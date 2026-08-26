import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBudgetAnalysisSummary, formatTargetMarginPercent, targetMarginFromDollars } from '../src/pages/budget/budgetAnalysisSummaryModel.js';

const financials = {
  revenue: 500000,
  directLabour: 150000,
  directEquipment: 100000,
  materials: 75000,
  subcontractors: 50000,
  totalOverhead: 100000,
};

test('Analysis summary uses authoritative financial totals and keeps target profit distinct', () => {
  const summary = buildBudgetAnalysisSummary(financials, 10);
  assert.deepEqual(summary.lines.map((line) => [line.label, line.amount]), [
    ['Revenue', 500000],
    ['Labour Cost', 150000],
    ['Equipment Cost', 100000],
    ['Material Cost', 75000],
    ['Subcontractor Cost', 50000],
    ['Overhead Cost', 100000],
    ['Net Profit', 52777.77777777775],
  ]);
  assert.equal(summary.totalPlannedCosts, 475000);
  assert.equal(summary.currentProfit, 25000);
  assert.equal(summary.currentProfitMarginPct, 5);
  assert.ok(Math.abs(summary.targetNetProfit - 52777.77777777775) < 0.000001);
  assert.ok(Math.abs(summary.requiredRevenue - 527777.7777777778) < 0.000001);
  assert.ok(Math.abs(summary.shortfall - 27777.77777777775) < 0.000001);
  assert.equal(summary.feasible, false);
});

test('percentage mode values use Revenue and dollar entry derives the one margin target', () => {
  const summary = buildBudgetAnalysisSummary(financials, 10);
  assert.equal(summary.lines[0].percentOfRevenue, 100);
  assert.equal(summary.lines[1].percentOfRevenue, 30);
  assert.ok(Math.abs(targetMarginFromDollars(52777.7777777778, 475000) - 10) < 0.000001);
  assert.equal(targetMarginFromDollars(0, 0), 0);
});

test('chart uses summary values and preserves an over-target shortfall without normalization', () => {
  const summary = buildBudgetAnalysisSummary(financials, 10);
  assert.deepEqual(summary.chartSegments.map((segment) => segment.amount), summary.lines.slice(1).map((line) => line.amount));
  assert.ok(Math.abs(summary.chartTotal - 527777.7777777778) < 0.000001);
  assert.equal(summary.revenueMarkerPct, 500000 / summary.chartTotal * 100);
  assert.equal(summary.chartSegments.reduce((sum, segment) => sum + segment.widthPct, 0), 100);

  const feasible = buildBudgetAnalysisSummary({ ...financials, totalOverhead: 50000 }, 10);
  assert.equal(feasible.shortfall, 0);
  assert.ok(Math.abs(feasible.surplusAfterTarget - 27777.77777777781) < 0.000001);
  assert.equal(feasible.chartTotal, feasible.revenue);
});

test('Target Profit Margin display preserves meaningful precision without trailing zeroes', () => {
  assert.equal(formatTargetMarginPercent(78.4313725), '78.43%');
  assert.equal(formatTargetMarginPercent(20), '20%');
});