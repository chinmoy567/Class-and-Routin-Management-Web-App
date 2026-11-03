import { registerPolicies } from '../../policy/index.js';
import { dashboardPolicy } from './dashboard.policy.js';

registerPolicies(dashboardPolicy);

export { dashboardRouter, rosterRouter } from './dashboard.routes.js';
export { registerDashboardCard, resetDashboardCards } from './cards.js';
export { getDashboard } from './dashboard.service.js';
export { getSectionRoster } from './roster.service.js';
