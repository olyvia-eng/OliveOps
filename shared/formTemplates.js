const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

const templates = [
  {
    name: 'Morning Truck Inspection', category: 'vehicle',
    description: 'Daily pre-trip checklist for truck condition and safety readiness.',
    fields: [
      { type: 'date', label: 'Inspection Date', required: true },
      { type: 'employee_selector', label: 'Driver', required: true },
      { type: 'yes_no', label: 'Lights and signals working?', required: true },
      { type: 'multi_line_text', label: 'Notes / Deficiencies' },
    ],
  },
  {
    name: 'MTO Daily Inspection', category: 'vehicle',
    description: 'Regulatory daily commercial vehicle inspection.',
    fields: [
      { type: 'date', label: 'Inspection Date', required: true },
      { type: 'yes_no', label: 'Brakes checked?', required: true },
      { type: 'yes_no', label: 'Tires checked?', required: true },
      { type: 'signature', label: 'Driver Signature', required: true },
    ],
  },
  {
    name: 'Vehicle Damage Report', category: 'vehicle',
    description: 'Capture vehicle damage, location, and incident details.',
    fields: [
      { type: 'date', label: 'Incident Date', required: true },
      { type: 'photo_upload', label: 'Damage Photos', required: true },
      { type: 'multi_line_text', label: 'Damage Description', required: true },
      { type: 'signature', label: 'Employee Signature', required: true },
    ],
  },
  {
    name: 'Excavator Daily Inspection', category: 'equipment',
    description: 'Daily excavator check before operation.',
    fields: [
      { type: 'dropdown', label: 'Equipment', required: true },
      { type: 'yes_no', label: 'Hydraulic leaks present?', required: true },
      { type: 'yes_no', label: 'Tracks and undercarriage OK?', required: true },
      { type: 'multi_line_text', label: 'Inspection Notes' },
    ],
  },
  {
    name: 'Skid Steer Inspection', category: 'equipment',
    description: 'Daily skid steer condition and functionality checklist.',
    fields: [
      { type: 'dropdown', label: 'Equipment', required: true },
      { type: 'yes_no', label: 'Attachment secured?', required: true },
      { type: 'yes_no', label: 'Backup alarm functional?', required: true },
      { type: 'multi_line_text', label: 'Issues Found' },
    ],
  },
  {
    name: 'Fuel Log', category: 'equipment', description: 'Track fuel usage by job and equipment.',
    fields: [
      { type: 'date', label: 'Fuel Date', required: true },
      { type: 'number', label: 'Litres / Gallons', required: true },
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'dropdown', label: 'Equipment', required: true },
    ],
  },
  {
    name: 'Toolbox Talk Attendance', category: 'safety',
    description: 'Attendance and notes for daily/weekly toolbox talks.',
    fields: [
      { type: 'date', label: 'Talk Date', required: true },
      { type: 'single_line_text', label: 'Topic', required: true },
      { type: 'multi_line_text', label: 'Attendees', required: true },
      { type: 'signature', label: 'Supervisor Signature', required: true },
    ],
  },
  {
    name: 'Tailgate Safety Meeting', category: 'safety',
    description: 'Field-level safety meeting checklist and outcomes.',
    fields: [
      { type: 'date', label: 'Meeting Date', required: true },
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'multi_line_text', label: 'Hazards Discussed', required: true },
      { type: 'signature', label: 'Facilitator Signature', required: true },
    ],
  },
  {
    name: 'Hazard Assessment', category: 'safety', description: 'Pre-task hazard assessment and controls.',
    fields: [
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'multi_line_text', label: 'Identified Hazards', required: true },
      { type: 'multi_line_text', label: 'Controls Implemented', required: true },
      { type: 'signature', label: 'Assessor Signature', required: true },
    ],
  },
  {
    name: 'Near Miss Report', category: 'safety', description: 'Document near misses for corrective action tracking.',
    fields: [
      { type: 'date', label: 'Event Date', required: true },
      { type: 'multi_line_text', label: 'What Happened?', required: true },
      { type: 'multi_line_text', label: 'Corrective Actions', required: true },
      { type: 'photo_upload', label: 'Photo Evidence' },
    ],
  },
  {
    name: 'Incident Report', category: 'safety',
    description: 'Capture incident details and immediate response actions.',
    fields: [
      { type: 'date', label: 'Incident Date', required: true },
      { type: 'time', label: 'Incident Time', required: true },
      { type: 'multi_line_text', label: 'Incident Details', required: true },
      { type: 'signature', label: 'Reporter Signature', required: true },
    ],
  },
  {
    name: 'Daily Site Checklist', category: 'job_site',
    description: 'General daily site readiness and controls checklist.',
    fields: [
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'yes_no', label: 'Site secured?', required: true },
      { type: 'yes_no', label: 'Materials staged?', required: true },
      { type: 'multi_line_text', label: 'Notes' },
    ],
  },
  {
    name: 'End of Day Site Cleanup', category: 'job_site',
    description: 'Confirm cleanup and secure site at end of day.',
    fields: [
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'yes_no', label: 'Waste removed?', required: true },
      { type: 'yes_no', label: 'Equipment secured?', required: true },
      { type: 'photo_upload', label: 'Cleanup Photos' },
    ],
  },
  {
    name: 'Job Completion Checklist', category: 'job_site', description: 'Closeout checklist before job signoff.',
    fields: [
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'checkbox', label: 'All punch list items complete?', required: true },
      { type: 'multi_line_text', label: 'Outstanding Items' },
      { type: 'signature', label: 'Supervisor Signature', required: true },
    ],
  },
  {
    name: 'Customer Walkthrough', category: 'job_site', description: 'Capture walkthrough notes and client signoff.',
    fields: [
      { type: 'customer_selector', label: 'Customer', required: true },
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'multi_line_text', label: 'Walkthrough Notes', required: true },
      { type: 'signature', label: 'Customer Signature', required: true },
    ],
  },
  {
    name: 'Vacation Request', category: 'hr', description: 'Employee request for vacation approval.',
    fields: [
      { type: 'employee_selector', label: 'Employee', required: true },
      { type: 'date', label: 'Start Date', required: true },
      { type: 'date', label: 'End Date', required: true },
      { type: 'multi_line_text', label: 'Notes' },
    ],
  },
  {
    name: 'Time Correction Request', category: 'hr', description: 'Request correction for clock-in/out records.',
    fields: [
      { type: 'employee_selector', label: 'Employee', required: true },
      { type: 'date', label: 'Date Needing Correction', required: true },
      { type: 'multi_line_text', label: 'Correction Details', required: true },
      { type: 'signature', label: 'Employee Signature', required: true },
    ],
  },
  {
    name: 'Daily Crew Checklist', category: 'operations', description: 'Daily operations checklist for field crew.',
    fields: [
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'yes_no', label: 'Crew briefing completed?', required: true },
      { type: 'yes_no', label: 'Tools and equipment ready?', required: true },
      { type: 'multi_line_text', label: 'Crew Notes' },
    ],
  },
  {
    name: 'Supervisor Daily Report', category: 'operations',
    description: 'Supervisor report of work progress, blockers, and risks.',
    fields: [
      { type: 'job_selector', label: 'Job', required: true },
      { type: 'multi_line_text', label: 'Work Completed Today', required: true },
      { type: 'multi_line_text', label: 'Issues / Delays', required: true },
      { type: 'signature', label: 'Supervisor Signature', required: true },
    ],
  },
];

export const FORM_TEMPLATES = Object.freeze(templates.map((template) => Object.freeze({
  ...template,
  id: slug(template.name),
  fields: Object.freeze(template.fields.map((field) => Object.freeze({
    ...field,
    options: Object.freeze([...(field.options ?? [])]),
    acceptedResponse: field.acceptedResponse ? Object.freeze({ ...field.acceptedResponse }) : undefined,
  }))),
})));

export function getFormTemplate(templateId) {
  return FORM_TEMPLATES.find((template) => template.id === templateId) ?? null;
}

export function getFormTemplateDeliveryRule(templateName) {
  if (['Excavator Daily Inspection', 'Morning Truck Inspection', 'MTO Daily Inspection'].includes(templateName)) {
    return { type: 'before_clock_in', frequency: 'once_daily', completionBehavior: 'blocking', schedule: null, allowManualAccess: false };
  }
  return { type: 'always_available', frequency: null, completionBehavior: 'manual', schedule: null, allowManualAccess: true };
}