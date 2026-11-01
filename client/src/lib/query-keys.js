/** All TanStack Query keys live here. Feature specs add theirs. */
export const qk = {
  health: () => ['health'],
  me: () => ['me'],
  profile: () => ['profile'],
  user: (id) => ['user', id],
  departments: () => ['departments'],
  adminDepartments: () => ['admin', 'departments'],
  admins: () => ['admin', 'admins'],
  currentSemester: () => ['semester', 'current'],
  adminSemesters: () => ['admin', 'semesters'],
  userSearch: (q) => ['admin', 'user-search', q],
};
