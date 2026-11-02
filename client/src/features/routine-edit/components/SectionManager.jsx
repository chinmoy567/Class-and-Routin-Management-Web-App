import { useState } from 'react';
import { Button } from '@/components/ui/button.jsx';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { t } from '@/lib/i18n';
import { useAddGroup, useCreateSection, useRemoveGroup, useRenameGroup } from '../hooks.js';

const inputClass = 'h-11 rounded-md border bg-background px-3 text-sm';

function Groups({ section }) {
  const add = useAddGroup();
  const rename = useRenameGroup();
  const remove = useRemoveGroup();
  const [label, setLabel] = useState('');
  const [renaming, setRenaming] = useState(null); // { id, label }
  const error = add.error ?? rename.error ?? remove.error;
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">{t('routineEdit.sections.groups')}</h3>
      {section.groups.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('routineEdit.sections.noGroups')}</p>
      )}
      <ul className="space-y-2">
        {section.groups.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-12 font-medium">{g.label}</span>
            {section.can_manage && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setRenaming({ id: g.id, label: g.label })}
                >
                  {t('routineEdit.sections.rename')}
                  <span className="sr-only"> {g.label}</span>
                </Button>
                <Button type="button" variant="secondary" onClick={() => remove.mutate(g.id)}>
                  {t('routineEdit.sections.remove', { label: g.label })}
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {renaming && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename.mutate(
              { id: renaming.id, label: renaming.label },
              { onSuccess: () => setRenaming(null) },
            );
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="rename-label" className="block text-sm font-medium">
              {t('routineEdit.sections.renameLabel', {
                label: section.groups.find((g) => g.id === renaming.id)?.label ?? '',
              })}
            </label>
            <input
              id="rename-label"
              className={inputClass}
              value={renaming.label}
              onChange={(e) => setRenaming({ ...renaming, label: e.target.value })}
            />
          </div>
          <Button type="submit">{t('routineEdit.sections.save')}</Button>
        </form>
      )}
      {section.can_manage ? (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate({ sectionId: section.id, label }, { onSuccess: () => setLabel('') });
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="new-group" className="block text-sm font-medium">
              {t('routineEdit.sections.newGroup')}
            </label>
            <input
              id="new-group"
              className={inputClass}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <Button type="submit">{t('routineEdit.sections.addGroup')}</Button>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">{t('routineEdit.sections.cannotManage')}</p>
      )}
      <FormError error={error} />
    </div>
  );
}

function AddSection({ semesterId, departmentId }) {
  const create = useCreateSection();
  const [form, setForm] = useState({ level: '1', term: 'I', letter: '' });
  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({
          semester_id: semesterId,
          department_id: departmentId,
          level: Number(form.level),
          term: form.term,
          letter: form.letter,
        });
      }}
    >
      <h3 className="font-semibold">{t('routineEdit.sections.add')}</h3>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <label htmlFor="sec-level" className="block text-sm font-medium">
            {t('routineEdit.sections.level')}
          </label>
          <select id="sec-level" className={inputClass} value={form.level} onChange={set('level')}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="sec-term" className="block text-sm font-medium">
            {t('routineEdit.sections.term')}
          </label>
          <select id="sec-term" className={inputClass} value={form.term} onChange={set('term')}>
            <option value="I">{t('routineEdit.sections.termI')}</option>
            <option value="II">{t('routineEdit.sections.termII')}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="sec-letter" className="block text-sm font-medium">
            {t('routineEdit.sections.letter')}
          </label>
          <input
            id="sec-letter"
            maxLength={1}
            className={`${inputClass} w-20`}
            value={form.letter}
            onChange={set('letter')}
          />
        </div>
        <Button type="submit" disabled={create.isPending || !form.letter}>
          {t('routineEdit.sections.create')}
        </Button>
      </div>
      <FormError error={create.error} />
    </form>
  );
}

/** EDT-07 */
export function SectionManager({ semesterId, departmentId, section }) {
  return (
    <section aria-labelledby="sections-h" className="space-y-4 rounded-md border p-4">
      <h2 id="sections-h" className="text-lg font-semibold">
        {t('routineEdit.sections.title')}
      </h2>
      {departmentId && <AddSection semesterId={semesterId} departmentId={departmentId} />}
      {section && <Groups section={section} />}
    </section>
  );
}
