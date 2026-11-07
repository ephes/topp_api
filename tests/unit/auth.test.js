const { AuthController } = require('../../dist/auth/AuthController')
const { Config } = require('../../dist/config')
const { AuthError } = require('../../dist/types/api')

describe('bearer account contract', () => {
    test.each(['toString', 'constructor', '__proto__', '', ' ', 'unknown'])(
        'rejects unconfigured %p',
        (token) => {
            const auth = new AuthController({ 'synthetic-token': 17 })
            expect(() => auth.getAccountId(`Bearer ${token}`)).toThrow(
                AuthError
            )
        }
    )
    test.each([
        null,
        [],
        'map',
        {},
        { '': 1 },
        { ' ': 1 },
        { 'a b': 1 },
        { a: '1' },
        { a: 0 },
        { a: -1 },
        { a: 1.5 },
        { a: Infinity },
        { a: 2147483648 },
    ])('rejects malformed configuration %# without disclosing it', (map) => {
        expect(() => new AuthController(map)).toThrow(
            'Invalid accounts configuration'
        )
    })
    test('resolves only configured own keys and publishes numeric identity', async () => {
        const map = JSON.parse('{"__proto__":17,"synthetic-token":23}')
        const auth = new AuthController(map)
        const res = { locals: {} }
        const next = jest.fn()
        await auth.getMiddleware()(
            { headers: { authorization: 'Bearer synthetic-token' } },
            res,
            next
        )
        expect(res.locals.user).toEqual({ accountId: 23 })
        expect(next).toHaveBeenCalledWith()
        expect(auth.getAccountId('Bearer __proto__')).toBe(17)
        map['synthetic-token'] = 99
        expect(auth.getAccountId('Bearer synthetic-token')).toBe(23)
    })
    test('malformed JSON configuration has a safe diagnostic', () => {
        const previous = process.env.ACCOUNTS
        process.env.ACCOUNTS = '{synthetic-private-marker'
        try {
            expect(() => new Config().getAccountsMap()).toThrow(
                'Invalid accounts configuration'
            )
            try {
                new Config().getAccountsMap()
            } catch (err) {
                expect(err.message).not.toContain('synthetic-private-marker')
            }
        } finally {
            if (previous === undefined) delete process.env.ACCOUNTS
            else process.env.ACCOUNTS = previous
        }
    })
})
