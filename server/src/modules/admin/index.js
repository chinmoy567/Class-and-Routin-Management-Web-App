import { registerPolicies } from '../../policy/index.js';
import { adminPolicy } from './admin.policy.js';

registerPolicies(adminPolicy);

export { adminRouter } from './admin.routes.js';
