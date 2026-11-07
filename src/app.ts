import express, {
    Express,
    Request,
    Response,
    RequestHandler,
    NextFunction,
} from 'express'
import bodyParser from 'body-parser'
import { body, validationResult } from 'express-validator'
import { EventsApi, ConnectorApi } from './api'
import { AuthController } from './auth/AuthController'
import { HttpError, PayloadError } from './types/api'
import { healthCheck } from './healthcheck'
import { unless } from './expressHelpers'
import { FeedbackApi } from './api/FeedbackApi'
import { StatusApi } from './api/StatusApi'
import { AnalyticsApi } from './api/AnalyticsApi'
import {
    feedbackSubmissionBoundary,
    userHashMiddleware,
    privateErrorHandler,
    logRequestFailure,
} from './httpSecurity'

export interface AppServices {
    authController: AuthController
    eventsApi: EventsApi
    connectorApi: ConnectorApi
    feedbackApi: FeedbackApi
    statusApi: StatusApi
    analyticsApi: AnalyticsApi
    dbHealthy: () => Promise<boolean>
    publicOrigin: string
    trustProxy?: string[] | false
}

export function createApp({
    authController,
    eventsApi,
    connectorApi,
    feedbackApi,
    statusApi,
    analyticsApi,
    dbHealthy,
    publicOrigin,
    trustProxy = false,
}: AppServices): Express {
    // defines all endpoints where auth is not required
    const publicEndpoints = [
        '^/images/*',
        '^/health',
        '^/feedback/*',
        '^/comments/*',
    ]

    const app: Express = express()
    // Express/proxy-addr validates configured addresses and CIDRs at startup.
    try {
        app.set('trust proxy', trustProxy)
    } catch {
        throw new Error('Invalid trusted proxy configuration')
    }
    const requireFeedbackSubmission = feedbackSubmissionBoundary(publicOrigin)

    // extract json payload from body automatically
    app.use(bodyParser.json({ limit: '1mb' }))

    app.use(express.static('public'))
    app.set('view engine', 'handlebars')

    app.use(bodyParser.urlencoded({ extended: false }))

    // throw exception if not authorized
    app.use(unless(publicEndpoints, authController.getMiddleware()))

    // Only the payload-bearing ingestion routes require a body. Unknown routes
    // must reach the 404 handler even when the request has no body.
    app.post(
        ['/events', '/connector'],
        (req: Request, res: Response, next: NextFunction) => {
            if (Object.keys(req.body).length === 0) {
                return next(new PayloadError('Request format invalid'))
            }
            next()
        }
    )

    // request handler which runs after all other request handlers
    // and handles storing events in the database (event sourcing)
    app.use(async (req: Request, res: Response, next: NextFunction) => {
        const afterResponse = async () => {
            try {
                // See if we received an update from the previous request handlers
                // If not, we don't need to store anything
                // (Not all endpoints return an update)
                const update = res.locals.update
                if (!update) {
                    // All good, nothing to do. Call next() to continue
                    return
                }
                await statusApi.updateStatus(res.locals.user.accountId, update)
            } catch (err) {
                logRequestFailure('status-update')
            }
        }
        res.on('close', afterResponse)
        next()
    })

    const renderFeedback = async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            feedbackApi.validateVote(
                req.params.episodeId,
                req.params.feedbackType
            )
            const numberOfComments = await feedbackApi.getNumberOfComments(
                req.params.episodeId
            )
            res.render('feedback.hbs', {
                episodeId: req.params.episodeId,
                feedbackType: req.params.feedbackType,
                numberOfComments,
                confirmed: false,
            })
        } catch (err) {
            next(err)
        }
    }
    app.get('/feedback/:episodeId/:feedbackType', renderFeedback)
    app.post(
        '/feedback/:episodeId/:feedbackType',
        requireFeedbackSubmission,
        userHashMiddleware,
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                await feedbackApi.handleApiPost(
                    req.params.episodeId,
                    res.locals.userHash,
                    req.params.feedbackType
                )
                const numberOfComments = await feedbackApi.getNumberOfComments(
                    req.params.episodeId
                )
                res.render('feedback.hbs', {
                    episodeId: req.params.episodeId,
                    feedbackType: req.params.feedbackType,
                    numberOfComments,
                    confirmed: true,
                })
            } catch (err) {
                next(err)
            }
        }
    )

    // Analytics endpoint, which returns a JSON of the query results.
    // Check that the user is allowed to access the endpoint
    // and then run the query
    // The endpoint must contain a version number and a query name
    // e.g. /analytics/v1/someQuery
    app.get(
        '/analytics/:version/:query',
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const version = req.params.version
                const query = req.params.query

                const accountId = res.locals.user.accountId

                const response = await analyticsApi.getAnalytics(
                    accountId,
                    `${version}/${query}`
                )

                if (response) {
                    res.json(response)
                }
            } catch (err) {
                next(err)
            }
        }
    )

    // Status endpoint, which returns a JSON of the last import time per endpoint.
    // This uses our internal event sourcing to determine the last imports.
    app.get(
        '/status',
        async (req: Request, res: Response, next: NextFunction) => {
            try {
                const status = await statusApi.getStatus(
                    res.locals.user.accountId
                )
                res.json(status)
            } catch (err) {
                next(err)
            }
        }
    )

    app.post(
        '/comments/:episodeId',
        requireFeedbackSubmission,
        userHashMiddleware,
        body('email').isEmail(),
        body('comment').not().isEmpty().trim().isLength({ min: 3, max: 1000 }),
        async (req: Request, res: Response, next: NextFunction) => {
            const errors = validationResult(req)
            if (!errors.isEmpty()) {
                return next(new PayloadError('Invalid comment'))
            }

            const episodeId = req.params.episodeId
            try {
                await feedbackApi.handleCommentPost(
                    episodeId,
                    res.locals.userHash,
                    req.body.comment
                )

                res.render('comment.hbs')
            } catch (err) {
                next(err)
            }
        }
    )

    // endpoint for events coming from the proxy
    app.post('/events', (async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        // express can't directly catch errors in await calls, so we have re-throw it
        try {
            await eventsApi.handleApiPost(res.locals.user.accountId, req.body)
            res.send('Data stored. Thx')
        } catch (err) {
            next(err)
        }
    }) as RequestHandler)

    // endpoint for the connectors importing data from spotify and apple
    app.post('/connector', (async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        try {
            const connectorPayload = await connectorApi.handleApiPost(
                res.locals.user.accountId,
                req.body
            )
            res.send('Data stored. Thx')

            // Construct a payload for event sourcing
            res.locals.update = {
                endpoint: connectorPayload.meta.endpoint,
                // TODO: Which data should be stored?
                data: connectorPayload.data,
            }
        } catch (err) {
            next(err)
        }
    }) as RequestHandler)

    app.get(
        '/health',
        healthCheck({
            db: dbHealthy,
        })
    )

    // catch 404 and forward to error handler
    app.use(function (req: Request, res: Response, next: NextFunction) {
        const err = new HttpError('Not Found')
        err.status = 404
        next(err)
    })

    app.use(privateErrorHandler)

    return app
}
