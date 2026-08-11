export interface ScheduleColour { value: string; tint: string }
export const SCHEDULE_COLOUR_PALETTE: Array<ScheduleColour & { id: string }>;
export const NEUTRAL_SCHEDULE_COLOUR: ScheduleColour;
export const GOOGLE_SCHEDULE_COLOUR: ScheduleColour;
export const JOB_STATUS_COLOURS: Record<string, ScheduleColour>;