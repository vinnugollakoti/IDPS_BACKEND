// Missing rows mean the app was added after a staff member's last permission edit.
// Explicitly denied rows always win.
const STAFF_MODULES = ['students','fees','circulars','exams','classes','attendance','timetable','notifications','permission','homework','whatsapp','spending','complaints','downloads','profile'] as const;
export function allowedModulesForRole(role: string, permissions: readonly {module:string;isAllowed:boolean}[]): string[] {
  const base = role === 'TEACHER'
    ? ['students','circulars','exams','attendance','timetable','notifications','homework','complaints','profile']
    : role === 'RECEPTIONIST'
      ? ['students','fees','circulars','exams','classes','attendance','timetable','notifications','homework','complaints','downloads','profile']
      : ['CHAIRMAN','DIRECTOR','PRINCIPAL'].includes(role)
        ? [...STAFF_MODULES]
        : [];
  const overrides = new Map(permissions.map(p=>[p.module,p.isAllowed]));
  return base.filter(module => overrides.get(module) !== false);
}
