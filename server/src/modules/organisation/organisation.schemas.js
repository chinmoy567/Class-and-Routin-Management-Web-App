import { z } from 'zod';
import { domainBody } from '@crm/shared';

export const addDomainBody = domainBody;
export const domainParams = z.object({ domain: domainBody.shape.domain });
