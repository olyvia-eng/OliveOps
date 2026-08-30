import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBudgetAnalysisSummary, formatTargetMarginPercent, isValidTargetMarginInput, MAX_TARGET_MARGIN_PCT, normalizeTargetMargin, targetMarginFromDollars } from '../src/pages/budget/budgetAnalysisSummaryModel.js';

const financials = {
  revenue: 500000,
  directLabour: 150000,
  directEquipment: 100000,
  materials: 75000,
  subcontractors: 50000,
  totalOverhead: 100000,
  operatingProfit: 25000,
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
    ['Net Profit', 25000],
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

test('chart uses current economics and target margin never changes its segmentation', () => {
  const summary = buildBudgetAnalysisSummary(financials, 10);
  assert.deepEqual(summary.chartSegments.map((segment) => segment.amount), summary.lines.slice(1).map((line) => line.amount));
  assert.equal(summary.chartTotal, 500000);
  assert.equal(summary.revenueMarkerPct, 100);
  assert.equal(summary.chartSegments.reduce((sum, segment) => sum + segment.widthPct, 0), 100);

  for (const targetMargin of [0, 5, 10, 50]) {
    assert.deepEqual(buildBudgetAnalysisSummary(financials, targetMargin).chartSegments, summary.chartSegments);
  }
});

test('chart shows actual profit above target and never creates a surplus segment', () => {
  const result = buildBudgetAnalysisSummary({ revenue: 1000000, directLabour: 300000, directEquipment: 100000, materials: 50000, subcontractors: 0, totalOverhead: 50000, operatingProfit: 500000 }, 10);
  assert.deepEqual(result.chartSegments.map(({ key, amount }) => [key, amount]), [
    ['labour', 300000], ['equipment', 100000], ['materials', 50000], ['subcontractors', 0], ['overhead', 50000], ['netProfit', 500000],
  ]);
  assert.equal(result.chartSegments.reduce((sum, segment) => sum + segment.amount, 0), result.revenue);
  assert.equal(result.chartSegments.some((segment) => /surplus|above target/i.test(segment.label)), false);
});

test('loss chart keeps positive costs and omits the negative profit slice', () => {
  const result = buildBudgetAnalysisSummary({ ...financials, revenue: 400000, operatingProfit: -75000 }, 10);
  assert.equal(result.currentProfit, -75000);
  assert.equal(result.chartSegments.some((segment) => segment.key === 'netProfit'), false);
  assert.equal(result.chartSegments.reduce((sum, segment) => sum + segment.amount, 0), 475000);
  assert.equal(result.chartTotal, 475000);
});

test('Target Profit Margin display preserves meaningful precision without trailing zeroes', () => {
  assert.equal(formatTargetMarginPercent(78.4313725), '78.43%');
  assert.equal(formatTargetMarginPercent(20), '20%');
});

test('target-margin economics distinguish current results from the revenue required at target', () => {
  const summary = buildBudgetAnalysisSummary({
    revenue: 510000,
    directLabour: 200000,
    directEquipment: 100000,
    materials: 80000,
    subcontractors: 40000,
    totalOverhead: 34420,
    operatingProfit: 55580,
  }, 50);

  assert.equal(summary.totalPlannedCosts, 454420);
  assert.equal(summary.currentProfit, 55580);
  assert.ok(Math.abs(summary.currentProfitMarginPct - 10.898039215686275) < 0.000001);
  assert.equal(summary.requiredRevenue, 908840);
  assert.equal(summary.targetNetProfit, 454420);
  assert.equal(summary.additionalRevenueNeeded, 398840);
  assert.equal(summary.shortfall, summary.additionalRevenueNeeded);
});

test('target-margin boundaries remain finite and reject invalid user input', () => {
  const zeroTarget = buildBudgetAnalysisSummary(financials, 0);
  assert.equal(zeroTarget.requiredRevenue, zeroTarget.totalPlannedCosts);
  assert.equal(zeroTarget.targetNetProfit, 0);

  const upperTarget = buildBudgetAnalysisSummary(financials, MAX_TARGET_MARGIN_PCT);
  assert.ok(Math.abs(upperTarget.requiredRevenue - upperTarget.totalPlannedCosts / 0.05) < 0.000001);
  assert.equal(Number.isFinite(upperTarget.requiredRevenue), true);
  assert.equal(isValidTargetMarginInput(MAX_TARGET_MARGIN_PCT), true);
  for (const invalid of [100, 101, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(isValidTargetMarginInput(invalid), false);
  }

  assert.equal(normalizeTargetMargin(100), MAX_TARGET_MARGIN_PCT);
  assert.equal(normalizeTargetMargin(Number.NaN), 0);
  for (const value of Object.values(buildBudgetAnalysisSummary(financials, 100))) {
    if (typeof value === 'number') assert.equal(Number.isFinite(value), true);
  }
});

test('target summary safely handles over-target, zero-cost, and zero-revenue Budgets', () => {
  const overTarget = buildBudgetAnalysisSummary({ ...financials, revenue: 1000000, operatingProfit: 525000 }, 10);
  assert.equal(overTarget.additionalRevenueNeeded, 0);
  assert.equal(overTarget.feasible, true);

  const zeroCosts = buildBudgetAnalysisSummary({ revenue: 100, directLabour: 0, directEquipment: 0, materials: 0, subcontractors: 0, totalOverhead: 0, operatingProfit: 100 }, 50);
  assert.equal(zeroCosts.requiredRevenue, 0);
  assert.equal(zeroCosts.targetNetProfit, 0);
  assert.equal(zeroCosts.additionalRevenueNeeded, 0);

  const zeroRevenue = buildBudgetAnalysisSummary({ ...financials, revenue: 0, operatingProfit: -475000 }, 50);
  assert.equal(zeroRevenue.currentProfit, -475000);
  assert.equal(zeroRevenue.currentProfitMarginPct, null);
  assert.equal(zeroRevenue.additionalRevenueNeeded, 950000);
  for (const value of [zeroRevenue.currentProfit, zeroRevenue.requiredRevenue, zeroRevenue.targetNetProfit, zeroRevenue.additionalRevenueNeeded]) {
    assert.equal(Number.isFinite(value), true);
  }
});