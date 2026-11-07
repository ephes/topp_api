const request = require('supertest')
const baseURL = 'http://localhost:8080'

// Run only against an isolated local API/database with synthetic fixtures.
describe('feedback confirmation flow', () => {
    test.each(['upvote', 'downvote'])(
        'GET renders confirmation for %s',
        async (vote) => {
            const response = await request(baseURL).get(
                `/feedback/123456/${vote}`
            )
            expect(response.statusCode).toBe(200)
            expect(response.text).toContain('Confirm your feedback')
            expect(response.text).toContain(`action="/feedback/123456/${vote}"`)
            expect(response.text).toContain('method="post"')
        }
    )
    test.each(['upvote', 'downvote'])(
        'explicit machine POST records %s',
        async (vote) => {
            const response = await request(baseURL)
                .post(`/feedback/123456/${vote}`)
                .set('X-Feedback-Client', 'api')
                .send({})
            expect(response.statusCode).toBe(200)
            expect(response.text).toContain('Thank you for your feedback!')
        }
    )
})
