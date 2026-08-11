export const SCHEDULE_COLOUR_PALETTE = [
  { id: 'teal', value: '#0f766e', tint: '#ccfbf1' },
  { id: 'blue', value: '#1d4ed8', tint: '#dbeafe' },
  { id: 'green', value: '#15803d', tint: '#dcfce7' },
  { id: 'amber', value: '#b45309', tint: '#fef3c7' },
  { id: 'red', value: '#b91c1c', tint: '#fee2e2' },
  { id: 'violet', value: '#6d28d9', tint: '#ede9fe' },
  { id: 'cyan', value: '#0e7490', tint: '#cffafe' },
  { id: 'rose', value: '#be123c', tint: '#ffe4e6' },
];

export const NEUTRAL_SCHEDULE_COLOUR = { value: '#4b5563', tint: '#f3f4f6' };
export const GOOGLE_SCHEDULE_COLOUR = { value: '#475569', tint: '#f1f5f9' };

export const JOB_STATUS_COLOURS = {
  scheduled: SCHEDULE_COLOUR_PALETTE[1],
  in_progress: SCHEDULE_COLOUR_PALETTE[2],
  on_hold: SCHEDULE_COLOUR_PALETTE[3],
  completed: SCHEDULE_COLOUR_PALETTE[0],
  cancelled: NEUTRAL_SCHEDULE_COLOUR,
};