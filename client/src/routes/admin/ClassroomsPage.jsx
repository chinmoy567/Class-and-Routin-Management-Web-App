import { useState } from 'react';
import { FormError } from '@/features/auth/components/FormError.jsx';
import { useDepartments, useMe } from '@/features/auth/hooks.js';
import {
  useAddRoomAlias,
  useAdminRooms,
  useCreateRoom,
  useRemoveRoomAlias,
  useRetireRoom,
  useSetRoomShares,
  useUpdateRoom,
} from '@/features/rooms/hooks.js';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { t } from '@/lib/i18n';

const ROOM_TYPES = ['classroom', 'lab'];

function TypeSelect({ id, value, onChange }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 w-full rounded-md border bg-background px-3 text-sm"
    >
      {ROOM_TYPES.map((type) => (
        <option key={type} value={type}>
          {t(`admin.classrooms.types.${type}`)}
        </option>
      ))}
    </select>
  );
}

/** ROOM-01: create form, or the edit form of one room (`editing` is the room). */
function RoomForm({ editing, departmentId, onDone }) {
  const create = useCreateRoom();
  const update = useUpdateRoom();
  const mutation = editing ? update : create;
  const [code, setCode] = useState(editing?.code ?? '');
  const [type, setType] = useState(editing?.type ?? 'classroom');
  const fields = mutation.error?.fields ?? {};
  const idPrefix = editing ? `room-${editing.id}` : 'room-new';

  function submit(event) {
    event.preventDefault();
    const body = editing
      ? { id: editing.id, code, type }
      : { code, type, department_id: departmentId };
    mutation.mutate(body, { onSuccess: onDone });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border p-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-code`} className="block text-sm font-medium">
          {t('admin.classrooms.code')}
        </label>
        <Input
          id={`${idPrefix}-code`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-invalid={fields.code ? 'true' : undefined}
          aria-describedby={`${idPrefix}-code-hint`}
        />
        <p id={`${idPrefix}-code-hint`} className="text-sm text-muted-foreground">
          {t('admin.classrooms.codeHint')}
        </p>
        {fields.code && (
          <p className="text-sm text-destructive">{t('admin.classrooms.fieldError.code')}</p>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-type`} className="block text-sm font-medium">
          {t('admin.classrooms.type')}
        </label>
        <TypeSelect id={`${idPrefix}-type`} value={type} onChange={setType} />
        {fields.type && (
          <p className="text-sm text-destructive">{t('admin.classrooms.fieldError.type')}</p>
        )}
        {fields.department_id && (
          <p className="text-sm text-destructive">
            {t('admin.classrooms.fieldError.department_id')}
          </p>
        )}
      </div>
      <FormError error={mutation.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {editing ? t('admin.classrooms.save') : t('admin.classrooms.create')}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          {t('admin.classrooms.cancel')}
        </Button>
      </div>
    </form>
  );
}

/** ROOM-02: alias chips with a remove button, and a small form to add one. */
function Aliases({ room }) {
  const add = useAddRoomAlias();
  const remove = useRemoveRoomAlias();
  const [alias, setAlias] = useState('');
  const fields = add.error?.fields ?? {};

  function submit(event) {
    event.preventDefault();
    add.mutate({ id: room.id, alias }, { onSuccess: () => setAlias('') });
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('admin.classrooms.aliases')}</p>
      {room.aliases.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('admin.classrooms.noAliases')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {room.aliases.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-1 rounded-full border px-3 py-1 text-sm"
            >
              <span>{a.alias}</span>
              {!room.retired && (
                <button
                  type="button"
                  className="min-h-6 min-w-6 rounded-full text-muted-foreground hover:text-foreground"
                  aria-label={t('admin.classrooms.removeAlias', { alias: a.alias })}
                  onClick={() => remove.mutate({ id: room.id, aliasId: a.id })}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <FormError error={remove.error} />
      {!room.retired && (
        <form onSubmit={submit} className="space-y-1.5" noValidate>
          <label htmlFor={`alias-${room.id}`} className="block text-sm font-medium">
            {t('admin.classrooms.aliasLabel')}
          </label>
          <div className="flex gap-2">
            <Input
              id={`alias-${room.id}`}
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              aria-invalid={fields.alias ? 'true' : undefined}
              aria-describedby={`alias-${room.id}-hint`}
            />
            <Button type="submit" variant="secondary" disabled={add.isPending}>
              {t('admin.classrooms.addAlias')}
            </Button>
          </div>
          <p id={`alias-${room.id}-hint`} className="text-sm text-muted-foreground">
            {t('admin.classrooms.aliasHint')}
          </p>
          {fields.alias && (
            <p className="text-sm text-destructive">{t('admin.classrooms.fieldError.alias')}</p>
          )}
          <FormError error={add.error} />
        </form>
      )}
    </div>
  );
}

/** ROOM-04: the sharing departments, with a checkbox list to change them. */
function Shares({ room, departments }) {
  const save = useSetRoomShares();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState(() => room.shares.map((s) => s.department_id));
  const others = departments.filter((d) => d.id !== room.owner_department_id);

  function toggle(id) {
    setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  }
  function submit(event) {
    event.preventDefault();
    save.mutate({ id: room.id, department_ids: picked }, { onSuccess: () => setEditing(false) });
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('admin.classrooms.shares')}</p>
      {!editing && (
        <>
          <p className="text-sm text-muted-foreground">
            {room.shares.length === 0
              ? t('admin.classrooms.noShares')
              : room.shares.map((s) => s.code).join(', ')}
          </p>
          {!room.retired && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('admin.classrooms.editShares')}
            </Button>
          )}
        </>
      )}
      {editing && (
        <form onSubmit={submit} className="space-y-2">
          <fieldset className="space-y-1">
            <legend className="sr-only">{t('admin.classrooms.shares')}</legend>
            {others.map((d) => (
              <label key={d.id} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(d.id)}
                  onChange={() => toggle(d.id)}
                />
                {d.code} {d.name}
              </label>
            ))}
          </fieldset>
          {save.error?.fields?.department_ids && (
            <p className="text-sm text-destructive">
              {t('admin.classrooms.fieldError.department_ids')}
            </p>
          )}
          <FormError error={save.error} />
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {t('admin.classrooms.saveShares')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              {t('admin.classrooms.cancel')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function RoomCard({ room, departments }) {
  const retire = useRetireRoom();
  const [editing, setEditing] = useState(false);

  function onRetire() {
    if (window.confirm(t('admin.classrooms.retireConfirm', { code: room.code }))) {
      retire.mutate(room.id);
    }
  }

  if (editing) {
    return (
      <li className="p-3">
        <RoomForm editing={room} onDone={() => setEditing(false)} />
      </li>
    );
  }
  return (
    <li className="space-y-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-medium">{room.code}</h3>
          <p className="text-sm text-muted-foreground">
            {t(`admin.classrooms.types.${room.type}`)}
            {room.retired && ` · ${t('admin.classrooms.retired')}`}
          </p>
        </div>
        {!room.retired && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(true)}>
              {t('admin.classrooms.edit')}
            </Button>
            <Button variant="destructive" onClick={onRetire}>
              {t('admin.classrooms.retire')}
            </Button>
          </div>
        )}
      </div>
      <FormError error={retire.error} />
      <Aliases room={room} />
      <Shares room={room} departments={departments} />
    </li>
  );
}

/** ROOM-01 to ROOM-08: the Classrooms page for department admins and super admins. */
export function ClassroomsPage() {
  const me = useMe();
  const departments = useDepartments(true);
  const roles = me.data?.roles ?? [];
  const isSuper = roles.some((r) => r.role === 'super_admin');
  const mine = roles.filter((r) => r.role === 'dept_admin').map((r) => r.department_id);
  const choices = (departments.data ?? []).filter((d) => isSuper || mine.includes(d.id));

  const [chosen, setChosen] = useState('');
  const departmentId = chosen || choices[0]?.id || '';
  const rooms = useAdminRooms(departmentId);
  const [adding, setAdding] = useState(false);

  if ((departments.isPending && !departments.error) || (rooms.isPending && departmentId)) {
    return <p>{t('common.loading')}</p>;
  }
  if (departments.error) return <FormError error={departments.error} />;
  if (rooms.error) return <FormError error={rooms.error} />;

  return (
    <section className="max-w-3xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t('admin.classrooms.title')}</h1>
        {!adding && departmentId && (
          <Button onClick={() => setAdding(true)}>{t('admin.classrooms.add')}</Button>
        )}
      </header>

      {choices.length > 1 && (
        <div className="space-y-1.5">
          <label htmlFor="classrooms-department" className="block text-sm font-medium">
            {t('admin.classrooms.department')}
          </label>
          <select
            id="classrooms-department"
            value={departmentId}
            onChange={(e) => {
              setChosen(e.target.value);
              setAdding(false);
            }}
            className="h-11 w-full rounded-md border bg-background px-3 text-sm sm:w-72"
          >
            {choices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} {d.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {adding && <RoomForm departmentId={departmentId} onDone={() => setAdding(false)} />}

      {rooms.data?.owned.length === 0 ? (
        <p>{t('admin.classrooms.empty')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rooms.data?.owned.map((room) => (
            <RoomCard key={room.id} room={room} departments={departments.data ?? []} />
          ))}
        </ul>
      )}

      <section aria-labelledby="shared-with-me" className="space-y-2">
        <h2 id="shared-with-me" className="text-lg font-semibold">
          {t('admin.classrooms.sharedWithMe')}
        </h2>
        {rooms.data?.shared_with_me.length ? (
          <ul className="divide-y rounded-md border">
            {rooms.data.shared_with_me.map((r) => (
              <li key={r.id} className="p-3">
                <p className="font-medium">{r.code}</p>
                <p className="text-sm text-muted-foreground">
                  {t(`admin.classrooms.types.${r.type}`)} ·{' '}
                  {t('admin.classrooms.ownedBy', { code: r.owner.code })}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('admin.classrooms.sharedWithMeEmpty')}</p>
        )}
      </section>
    </section>
  );
}
