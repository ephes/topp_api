const request = require('supertest')
const { createApp } = require('../../dist/app')
const { AuthController } = require('../../dist/auth/AuthController')
const { mysqlHealthy } = require('../../dist/healthcheck')
const { AnalyticsApi } = require('../../dist/api/AnalyticsApi')
const { AnalyticsRepository } = require('../../dist/db/AnalyticsRepository')
const { PayloadError } = require('../../dist/types/api')
const marker = 'synthetic-private-SQL-connection-marker'
function setup() {
    const fault = jest.fn(async () => {
        throw new Error(marker)
    })
    const app = createApp({
        publicOrigin: 'https://api.synthetic.example',
        authController: new AuthController({ 'synthetic-token': 1 }),
        analyticsApi: new AnalyticsApi(
            new AnalyticsRepository(
                { execute: fault },
                new Map([['v1/fault', 'SELECT ?']])
            )
        ),
        eventsApi: { handleApiPost: fault },
        statusApi: { getStatus: fault },
        feedbackApi: {},
        connectorApi: {},
        dbHealthy: mysqlHealthy({ query: fault }),
    })
    return { app, fault }
}
describe.each(['development', 'production'])(
    'bounded private errors in %s',
    (mode) => {
        let log, error, previous
        beforeEach(() => {
            previous = process.env.NODE_ENV
            process.env.NODE_ENV = mode
            log = jest.spyOn(console, 'log').mockImplementation(() => {})
            error = jest.spyOn(console, 'error').mockImplementation(() => {})
        })
        afterEach(() => {
            log.mockRestore()
            error.mockRestore()
            if (previous === undefined) delete process.env.NODE_ENV
            else process.env.NODE_ENV = previous
        })
        test.each([
            ['auth', 401, 'Not authorized'],
            ['json', 400, 'Invalid request'],
            ['route', 404, 'Not Found'],
            ['uri', 400, 'Invalid request'],
            ['status', 500, 'Internal server error'],
            ['analytics', 500, 'Internal server error'],
            ['missing-query', 404, 'Not Found'],
            ['large', 413, 'Request too large'],
        ])('%s has a stable safe response', async (kind, status, text) => {
            const { app, fault } = setup()
            let call
            switch (kind) {
                case 'auth':
                    call = request(app).get('/status')
                    break
                case 'json':
                    call = request(app)
                        .post('/events')
                        .type('json')
                        .send(`{"${marker}"`)
                    break
                case 'uri':
                    call = request(app).get('/feedback/%E0%A4%A/upvote')
                    break
                case 'route':
                    call = request(app)
                        .get('/unknown')
                        .auth('synthetic-token', { type: 'bearer' })
                    break
                case 'status':
                    call = request(app)
                        .get('/status')
                        .auth('synthetic-token', { type: 'bearer' })
                    break
                case 'analytics':
                    call = request(app)
                        .get('/analytics/v1/fault')
                        .auth('synthetic-token', { type: 'bearer' })
                    break
                case 'missing-query':
                    call = request(app)
                        .get('/analytics/v1/missing')
                        .auth('synthetic-token', { type: 'bearer' })
                    break
                case 'large':
                    call = request(app)
                        .post('/events')
                        .type('json')
                        .send({ payload: 'x'.repeat(1024 * 1024) })
                    break
            }
            const res = await call
            expect(res.status).toBe(status)
            expect(res.text).toBe(text)
            expect(res.text).not.toContain(marker)
            expect(res.text).not.toMatch(/Error:| at |<pre>/)
            expect(
                JSON.stringify([...log.mock.calls, ...error.mock.calls])
            ).not.toContain(marker)
            if (['status', 'analytics'].includes(kind))
                expect(fault).toHaveBeenCalledTimes(1)
        })
        test('known validation errors cannot disclose private details', async () => {
            const { app } = setup()
            // Exercise production error middleware via an actual API failure.
            const services = {
                publicOrigin: 'https://api.synthetic.example',
                authController: new AuthController({ 'synthetic-token': 1 }),
                eventsApi: {
                    handleApiPost: async () => {
                        throw new PayloadError(marker)
                    },
                },
                statusApi: {},
                analyticsApi: {},
                feedbackApi: {},
                connectorApi: {},
                dbHealthy: async () => true,
            }
            const res = await request(createApp(services))
                .post('/events')
                .auth('synthetic-token', { type: 'bearer' })
                .send({ synthetic: true })
            expect(res.status).toBe(400)
            expect(res.text).toBe('Invalid request')
            expect(JSON.stringify(error.mock.calls)).not.toContain(marker)
        })
        test('health failures return only health booleans and safe diagnostics', async () => {
            const { app, fault } = setup()
            const res = await request(app).get('/health')
            expect(res.status).toBe(500)
            expect(res.body).toEqual({ db: false })
            expect(fault).toHaveBeenCalledTimes(1)
            expect(
                JSON.stringify([...log.mock.calls, ...error.mock.calls])
            ).not.toContain(marker)
        })
    }
)

test('post-response update failures log only a fixed category', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    const updateStatus = jest.fn(async () => {
        throw new Error(marker)
    })
    try {
        const app = createApp({
            publicOrigin: 'https://api.synthetic.example',
            authController: new AuthController({ 'synthetic-token': 1 }),
            connectorApi: {
                handleApiPost: async () => ({
                    meta: { endpoint: 'synthetic' },
                    data: {},
                }),
            },
            statusApi: { updateStatus },
            analyticsApi: {},
            feedbackApi: {},
            eventsApi: {},
            dbHealthy: async () => true,
        })
        const res = await request(app)
            .post('/connector')
            .auth('synthetic-token', { type: 'bearer' })
            .send({ synthetic: true })
        expect(res.status).toBe(200)
        expect(updateStatus).toHaveBeenCalledTimes(1)
        expect(error).toHaveBeenCalledWith('Request failed', {
            kind: 'status-update',
            status: 500,
        })
        expect(JSON.stringify(error.mock.calls)).not.toContain(marker)
    } finally {
        error.mockRestore()
    }
})
