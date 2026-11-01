import { AppError } from './errors.js';

export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    const fields = {};
    for (const [key, schema] of Object.entries({ body, query, params })) {
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (result.success) {
        // req.query is a getter in Express 5, so redefine it instead of assigning
        Object.defineProperty(req, key, {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else {
        for (const issue of result.error.issues) {
          const path = [key === 'body' ? null : key, ...issue.path]
            .filter((p) => p !== null)
            .join('.');
          fields[path || key] = issue.message;
        }
      }
    }
    if (Object.keys(fields).length) {
      return next(new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', fields));
    }
    next();
  };
}
