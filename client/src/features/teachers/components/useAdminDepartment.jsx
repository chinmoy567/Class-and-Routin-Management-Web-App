import { useState } from 'react';
import { useDepartments, useMe } from '@/features/auth/hooks.js';
import { t } from '@/lib/i18n';

/** The departments the signed-in admin acts for, and the one chosen (the first by default). */
export function useAdminDepartment() {
  const me = useMe();
  const departments = useDepartments(true);
  const roles = me.data?.roles ?? [];
  const isSuper = roles.some((r) => r.role === 'super_admin');
  const mine = roles.filter((r) => r.role === 'dept_admin').map((r) => r.department_id);
  const choices = (departments.data ?? []).filter((d) => isSuper || mine.includes(d.id));
  const [chosen, setChosen] = useState('');
  return { departments, choices, departmentId: chosen || choices[0]?.id || '', setChosen };
}

export function DepartmentPicker({ id, choices, value, onChange }) {
  if (choices.length < 2) return null;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {t('teachers.department')}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-72"
      >
        {choices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.code} {d.name}
          </option>
        ))}
      </select>
    </div>
  );
}
