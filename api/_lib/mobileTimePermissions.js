export const DEFAULT_MOBILE_TIME_PERMISSIONS = Object.freeze({
  adjustClockInTime: false,
  editShiftWorkAreas: false,
});

export function normalizeMobileTimePermissions(value) {
  return {
    adjustClockInTime: value?.adjustClockInTime === true,
    editShiftWorkAreas: value?.editShiftWorkAreas === true,
  };
}