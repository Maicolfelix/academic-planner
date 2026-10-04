export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * The single answer for "does not exist" AND "belongs to someone else": identical status, code and
 * message, so a response never confirms that another user's resource exists.
 */
export const notFound = (message = 'Recurso no encontrado.') =>
  new AppError(404, 'NOT_FOUND', message);

/** Same envelope the Zod handler produces, for rules that need stored data to be checked. */
export const validationError = (fields: Record<string, string[]>) =>
  new AppError(400, 'VALIDATION_ERROR', 'Datos inválidos. Revisa los campos marcados.', { fields });
