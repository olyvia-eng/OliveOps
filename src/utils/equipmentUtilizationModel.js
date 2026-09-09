const nonNegativeFinite = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};

const oneDecimal = (value) => Math.round((nonNegativeFinite(value) + Number.EPSILON) * 10) / 10;

export function deriveOperatingDays(sellableHoursPerYear, equipmentHoursPerDay) {
  const annualHours = nonNegativeFinite(sellableHoursPerYear);
  const hoursPerDay = nonNegativeFinite(equipmentHoursPerDay);
  return hoursPerDay > 0 ? oneDecimal(annualHours / hoursPerDay) : 0;
}

export function synchronizeEquipmentUtilization(value, basis, editedField, editedValue, operatingDays) {
  const annualHours = oneDecimal(value?.sellableHoursPerYear);
  const hoursPerDay = oneDecimal(value?.equipmentHoursPerDay);
  const days = oneDecimal(operatingDays);
  const nextValue = oneDecimal(editedValue);

  if (editedField === 'annualHours') {
    return {
      basis: 'annualHours',
      sellableHoursPerYear: nextValue,
      equipmentHoursPerDay: hoursPerDay,
      operatingDays: deriveOperatingDays(nextValue, hoursPerDay),
    };
  }

  if (editedField === 'operatingDays') {
    if (nextValue > 0 && hoursPerDay <= 0) {
      return { basis: 'operatingDays', sellableHoursPerYear: annualHours, equipmentHoursPerDay: hoursPerDay, operatingDays: days };
    }
    return {
      basis: 'operatingDays',
      sellableHoursPerYear: oneDecimal(nextValue * hoursPerDay),
      equipmentHoursPerDay: hoursPerDay,
      operatingDays: nextValue,
    };
  }

  const hasUtilization = basis === 'operatingDays' ? days > 0 : annualHours > 0;
  if (nextValue <= 0 && hasUtilization) {
    return { basis, sellableHoursPerYear: annualHours, equipmentHoursPerDay: hoursPerDay, operatingDays: days };
  }
  return basis === 'operatingDays'
    ? { basis, sellableHoursPerYear: oneDecimal(days * nextValue), equipmentHoursPerDay: nextValue, operatingDays: days }
    : { basis, sellableHoursPerYear: annualHours, equipmentHoursPerDay: nextValue, operatingDays: deriveOperatingDays(annualHours, nextValue) };
}