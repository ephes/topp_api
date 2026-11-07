beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => jest.restoreAllMocks())

const request = require('supertest')
const crypto = require('crypto')
const { createApp } = require('../../dist/app')
const { AuthController } = require('../../dist/auth/AuthController')
const { FeedbackApi } = require('../../dist/api/FeedbackApi')
const origin = 'https://api.synthetic.example'
function setup(trustProxy = false) {
    const repo = {
        addFeedback: jest.fn(async () => undefined),
        addComment: jest.fn(async () => undefined),
        getNumberOfComments: jest.fn(async () => 0),
    }
    const app = createApp({
        publicOrigin: origin,
        trustProxy,
        authController: new AuthController({ 'synthetic-token': 1 }),
        feedbackApi: new FeedbackApi(repo),
        statusApi: {},
        analyticsApi: {},
        eventsApi: {},
        connectorApi: {},
        dbHealthy: async () => true,
    })
    return { app, repo }
}
const agent = 'synthetic-listener'
function browserPost(app, path, browserOrigin = origin) {
    return request(app)
        .post(path)
        .set('Origin', browserOrigin)
        .set(
            'Sec-Fetch-Site',
            browserOrigin === origin ? 'same-origin' : 'cross-site'
        )
        .set('User-Agent', agent)
        .type('form')
}
function machinePost(app, path) {
    return request(app)
        .post(path)
        .set('X-Feedback-Client', 'api')
        .set('User-Agent', agent)
        .type('json')
}
test.each(['upvote', 'downvote'])(
    'GET/prefetch only renders a confirmation form for %s',
    async (vote) => {
        const { app, repo } = setup()
        const res = await request(app)
            .get(`/feedback/123/${vote}`)
            .set('Purpose', 'prefetch')
        expect(res.status).toBe(200)
        expect(repo.addFeedback).not.toHaveBeenCalled()
        expect(res.text).toContain(`action="/feedback/123/${vote}"`)
        expect(res.text).toContain('method="post"')
        expect(res.text).toContain('Confirm')
    }
)
test.each(['/feedback/123/upvote', '/comments/123'])(
    'hostile-origin and unmarked form submissions never mutate %s',
    async (path) => {
        const { app, repo } = setup()
        for (const headers of [
            { Origin: 'https://hostile.synthetic.example' },
            { Origin: 'null' },
            { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
            { 'Sec-Fetch-Site': 'same-site' },
            {},
        ]) {
            const res = await request(app)
                .post(path)
                .set(headers)
                .type('form')
                .send({
                    email: 'test@example.test',
                    comment: 'Synthetic comment',
                })
            expect(res.status).toBe(403)
        }
        expect(repo.addFeedback).not.toHaveBeenCalled()
        expect(repo.addComment).not.toHaveBeenCalled()
    }
)
test.each(['browser', 'machine'])(
    '%s deliberate posts vote and comment',
    async (mode) => {
        const { app, repo } = setup()
        const post = mode === 'browser' ? browserPost : machinePost
        expect((await post(app, '/feedback/123/upvote').send({})).status).toBe(
            200
        )
        expect(repo.addFeedback).toHaveBeenCalledWith(
            1,
            123,
            expect.stringMatching(/^[a-f0-9]{64}$/),
            true
        )
        expect(
            (
                await post(app, '/comments/123').send({
                    email: 'test@example.test',
                    comment: 'Synthetic comment',
                })
            ).status
        ).toBe(200)
        expect(repo.addComment).toHaveBeenCalledWith(
            1,
            123,
            expect.any(String),
            'Synthetic comment'
        )
    }
)
test('same-origin metadata supports browsers without Origin; JSON alone is not machine intent', async () => {
    const { app, repo } = setup()
    expect(
        (
            await request(app)
                .post('/feedback/123/upvote')
                .set('Sec-Fetch-Site', 'same-origin')
                .type('form')
                .send({})
        ).status
    ).toBe(200)
    expect(
        (
            await request(app)
                .post('/feedback/123/downvote')
                .type('json')
                .send({})
        ).status
    ).toBe(403)
    expect(repo.addFeedback).toHaveBeenCalledTimes(1)
})
test('same-origin Origin cannot be replaced by a forged Host', async () => {
    const { app, repo } = setup()
    const res = await browserPost(
        app,
        '/feedback/123/upvote',
        'https://hostile.synthetic.example'
    )
        .set('Host', 'hostile.synthetic.example')
        .send({})
    expect(res.status).toBe(403)
    expect(repo.addFeedback).not.toHaveBeenCalled()
})
test('direct forwarding spoof cannot change listener identity', async () => {
    const { app, repo } = setup()
    for (const ip of [
        '198.51.100.11',
        '198.51.100.12',
        '198.51.100.13, 203.0.113.5',
    ]) {
        expect(
            (
                await browserPost(app, '/feedback/123/upvote')
                    .set('X-Forwarded-For', ip)
                    .send({})
            ).status
        ).toBe(200)
    }
    const hashes = repo.addFeedback.mock.calls.map((args) => args[2])
    expect(new Set(hashes).size).toBe(1)
})
test('trusted proxy uses client IP, stopping at the first untrusted hop', async () => {
    const { app, repo } = setup(['loopback'])
    for (const ip of [
        '198.51.100.11, 203.0.113.5',
        '198.51.100.12, 203.0.113.5',
    ]) {
        await browserPost(app, '/feedback/123/upvote')
            .set('X-Forwarded-For', ip)
            .send({})
    }
    const expected = crypto
        .createHash('sha256')
        .update('203.0.113.5' + agent)
        .digest('hex')
    expect(repo.addFeedback.mock.calls.map((args) => args[2])).toEqual([
        expected,
        expected,
    ])
})
test('configured proxy CIDRs resolve the intended client; user agent hash input is bounded', async () => {
    const { app, repo } = setup(['loopback', '203.0.113.0/24'])
    const longAgent = 'x'.repeat(1024)
    await browserPost(app, '/feedback/123/upvote')
        .set('X-Forwarded-For', '198.51.100.11, 203.0.113.5')
        .set('User-Agent', longAgent)
        .send({})
    const expected = crypto
        .createHash('sha256')
        .update('198.51.100.11' + longAgent.slice(0, 512))
        .digest('hex')
    expect(repo.addFeedback).toHaveBeenCalledWith(1, 123, expected, true)
})
test.each(['/feedback/abc/upvote', '/feedback/123/invalid'])(
    'invalid vote input cannot mutate via GET or POST: %s',
    async (path) => {
        const { app, repo } = setup()
        expect((await request(app).get(path)).status).toBe(400)
        expect((await browserPost(app, path).send({})).status).toBe(400)
        expect(repo.addFeedback).not.toHaveBeenCalled()
    }
)

test('comment validation does not echo private submitted values', async () => {
    const { app, repo } = setup()
    const res = await browserPost(app, '/comments/123').send({
        email: 'synthetic-private-marker',
        comment: 'x',
    })
    expect(res.status).toBe(400)
    expect(res.text).toBe('Invalid request')
    expect(res.text).not.toContain('synthetic-private-marker')
    expect(repo.addComment).not.toHaveBeenCalled()
})

test('HEAD and GET stay observational across the confirmation flow', async () => {
    const { app, repo } = setup()
    expect((await request(app).head('/feedback/123/upvote')).status).toBe(200)
    expect((await request(app).get('/feedback/123/upvote')).status).toBe(200)
    expect(repo.addFeedback).not.toHaveBeenCalled()
    expect(
        (await machinePost(app, '/feedback/123/upvote').send({})).status
    ).toBe(200)
    expect(repo.addFeedback).toHaveBeenCalledTimes(1)
    expect((await request(app).get('/feedback/123/upvote')).status).toBe(200)
    expect(repo.addFeedback).toHaveBeenCalledTimes(1)
})
