const { Config } = require('../../dist/config')
const { createApp } = require('../../dist/app')
const { AuthController } = require('../../dist/auth/AuthController')
let config
beforeEach(() => {
    config = new Config()
})
function configured(key, value) {
    config.readStringFromEnvOrFile = (_key, fallback) =>
        _key === key ? value : fallback
    return config
}
test.each([
    '',
    'null',
    'file:///tmp',
    'https://user:synthetic-private@example.test',
    'https://example.test/path',
    'https://example.test/',
])('invalid origin configuration fails safely: %p', (value) => {
    expect(() => configured('PUBLIC_ORIGIN', value).getPublicOrigin()).toThrow(
        'PUBLIC_ORIGIN must be an HTTP(S) origin'
    )
})
test('explicit canonical public origin is accepted', () => {
    expect(
        configured(
            'PUBLIC_ORIGIN',
            'https://api.synthetic.example'
        ).getPublicOrigin()
    ).toBe('https://api.synthetic.example')
})
test('proxy policy defaults to peer and accepts explicit CIDR lists', () => {
    expect(configured('TRUST_PROXY', '').getTrustedProxies()).toBe(false)
    expect(
        configured(
            'TRUST_PROXY',
            'loopback, 203.0.113.0/24'
        ).getTrustedProxies()
    ).toEqual(['loopback', '203.0.113.0/24'])
})
test('invalid proxy settings fail without echoing configuration', () => {
    expect(() =>
        createApp({
            publicOrigin: 'https://api.synthetic.example',
            trustProxy: ['synthetic-private-invalid'],
            authController: new AuthController({ 'synthetic-token': 1 }),
        })
    ).toThrow('Invalid trusted proxy configuration')
})
