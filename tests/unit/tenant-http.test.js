const request = require('supertest')
const { createApp } = require('../../dist/app')
const { AuthController } = require('../../dist/auth/AuthController')
const { AnalyticsApi } = require('../../dist/api/AnalyticsApi')
const { AnalyticsRepository } = require('../../dist/db/AnalyticsRepository')
const { StatusApi } = require('../../dist/api/StatusApi')
const { StatusRepository } = require('../../dist/db/StatusRepository')

function setup() {
    const pool = {
        execute: jest.fn(async (_query, values) => [
            [{ account_id: values?.[0] }],
        ]),
        query: jest.fn(async (_query, values) => [
            [
                {
                    account_id: values?.[0] || 99,
                    endpoint: 'aggregate',
                    latest_update: '2026-01-01',
                },
            ],
        ]),
    }
    const app = createApp({
        authController: new AuthController({
            'synthetic-one': 1,
            'synthetic-two': 2,
        }),
        analyticsApi: new AnalyticsApi(
            new AnalyticsRepository(pool, new Map([['v1/ping', 'SELECT ?']]))
        ),
        statusApi: new StatusApi(new StatusRepository(pool)),
        feedbackApi: {},
        eventsApi: {},
        connectorApi: {},
        dbHealthy: async () => true,
    })
    return { app, pool }
}

describe('account-scoped production routes', () => {
    test.each([1, 2])(
        'analytics propagates authenticated account %i into bound SQL',
        async (id) => {
            const { app, pool } = setup()
            const res = await request(app)
                .get('/analytics/v1/ping')
                .auth(`synthetic-${id === 1 ? 'one' : 'two'}`, {
                    type: 'bearer',
                })
            expect(res.status).toBe(200)
            expect(res.body).toEqual([{ account_id: id }])
            expect(pool.execute).toHaveBeenCalledWith('SELECT ?', [id])
        }
    )
    test('anonymous status fails without querying storage', async () => {
        const { app, pool } = setup()
        expect((await request(app).get('/status')).status).toBe(401)
        expect(pool.query).not.toHaveBeenCalled()
    })
    test.each([1, 2])(
        'status returns only account %i and needs no request body',
        async (id) => {
            const { app, pool } = setup()
            const res = await request(app)
                .get('/status')
                .auth(`synthetic-${id === 1 ? 'one' : 'two'}`, {
                    type: 'bearer',
                })
            expect(res.status).toBe(200)
            expect(Object.keys(res.body)).toEqual([String(id)])
            expect(pool.query).toHaveBeenCalledWith(
                expect.stringMatching(/WHERE account_id = \?/),
                [id]
            )
        }
    )
    test('health remains public without revealing tenant status', async () => {
        const { app, pool } = setup()
        const res = await request(app).get('/health')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({ db: true })
        expect(pool.query).not.toHaveBeenCalled()
    })
})

test('analytics keeps the named-query allowlist and endpoint grammar', async () => {
    const pool = { execute: jest.fn() }
    const api = new AnalyticsApi(
        new AnalyticsRepository(pool, new Map([['v1/ping', 'SELECT ?']]))
    )
    for (const name of ['v1/missing', 'v999/ping', '../ping', 'v1/ping;DROP']) {
        await expect(api.getAnalytics(1, name)).rejects.toThrow()
    }
    expect(pool.execute).not.toHaveBeenCalled()
})
