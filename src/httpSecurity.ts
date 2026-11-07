import crypto from 'crypto'
import { NextFunction, Request, Response, RequestHandler } from 'express'
import { HttpError } from './types/api'

// Browser forms must originate at the configured public origin. Nonbrowser
// clients opt in with JSON plus a header that cross-origin forms cannot send.
export function feedbackSubmissionBoundary(
    publicOrigin: string
): RequestHandler {
    try {
        const url = new URL(publicOrigin)
        if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.origin !== publicOrigin
        ) {
            throw new Error()
        }
    } catch {
        throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin')
    }
    return (req, res, next) => {
        const origin = req.get('origin')
        const site = req.get('sec-fetch-site')
        const browserAllowed =
            (origin === publicOrigin || site === 'same-origin') &&
            (origin === undefined || origin === publicOrigin) &&
            (site === undefined || site === 'same-origin')
        const machineAllowed =
            origin === undefined &&
            site === undefined &&
            req.is('application/json') &&
            req.get('x-feedback-client') === 'api'
        if (!browserAllowed && !machineAllowed) {
            const error = new HttpError('Forbidden')
            error.status = 403
            return next(error)
        }
        next()
    }
}

export const userHashMiddleware: RequestHandler = (req, res, next) => {
    const ip = (req.ip || '').slice(0, 128)
    const agent = (req.get('user-agent') || '').slice(0, 512)
    res.locals.userHash = crypto
        .createHash('sha256')
        .update(ip + agent)
        .digest('hex')
    next()
}

// Never log error objects, request bodies, URLs, tokens or database diagnostics.
export function logRequestFailure(
    kind: 'status-update' | 'http',
    status = 500
) {
    console.error('Request failed', { kind, status })
}

const publicMessages: { [status: number]: string } = {
    400: 'Invalid request',
    401: 'Not authorized',
    403: 'Forbidden',
    404: 'Not Found',
    413: 'Request too large',
    415: 'Unsupported media type',
    500: 'Internal server error',
}

// Keep all four arguments: Express uses the arity to register error middleware.
export function privateErrorHandler(
    err: unknown,
    req: Request,
    res: Response,
    next: NextFunction
) {
    let status = 500
    if (err instanceof HttpError && [400, 401, 403, 404].includes(err.status)) {
        status = err.status
    } else if (
        err instanceof URIError &&
        'status' in err &&
        err.status === 400
    ) {
        // Express marks malformed percent-encoded route parameters as input errors.
        status = 400
    } else if (err instanceof Error && 'type' in err) {
        const type = (err as Error & { type: unknown }).type
        if (type === 'entity.too.large') status = 413
        else if (
            type === 'entity.parse.failed' ||
            type === 'request.aborted' ||
            type === 'request.size.invalid'
        )
            status = 400
        else if (
            type === 'encoding.unsupported' ||
            type === 'charset.unsupported'
        )
            status = 415
    }
    logRequestFailure('http', status)
    if (res.headersSent) {
        // Preserve Express's closing behavior, forwarding only a sanitized error.
        return next(new Error('Internal server error'))
    }
    res.status(status).type('text/plain').send(publicMessages[status])
}
