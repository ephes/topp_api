const mysql = require('mysql2/promise')
const fs = require('fs')
const crypto = require('crypto')
const { QueryLoader } = require('../../dist/db/QueryLoader')
const { AnalyticsApi } = require('../../dist/api/AnalyticsApi')
const { AnalyticsRepository } = require('../../dist/db/AnalyticsRepository')
const { StatusRepository } = require('../../dist/db/StatusRepository')

// This suite creates and drops only its own random database. No application env is read.
const database = `topp_synthetic_${crypto.randomBytes(8).toString('hex')}`
let admin, pool, api, status
const queries = new QueryLoader('./db_schema/queries').loadQueries()
const requiredTables = [
    'spotifyPodcastAggregate',
    'spotifyEpisodeAggregate',
    'spotifyEpisodeMetadata',
    'spotifyEpisodePerformance',
    'appleEpisodeMetadata',
    'appleEpisodeDetails',
]
async function insert(table, values) {
    await pool.query(`INSERT INTO ${mysql.escapeId(table)} SET ?`, values)
}
async function seed(accountId, date, factor) {
    const genders = {
        spa_gender_female: 2 * factor,
        spa_gender_male: 3 * factor,
        spa_gender_non_binary: factor,
        spa_gender_not_specified: 4 * factor,
    }
    for (const table of [
        'spotifyEpisodeAggregate',
        'spotifyPodcastAggregate',
    ]) {
        const common = {
            account_id: accountId,
            spa_date: date,
            ...(table === 'spotifyEpisodeAggregate'
                ? { episode_id: 'same-id' }
                : {}),
        }
        await insert(table, {
            ...common,
            ...genders,
            spa_facet: '18-24',
            spa_facet_type: 'age',
        })
        await insert(table, {
            ...common,
            spa_gender_female: 20 * factor,
            spa_gender_male: 0,
            spa_gender_non_binary: 0,
            spa_gender_not_specified: 0,
            spa_facet: 'all',
            spa_facet_type: 'age_sum',
        })
    }
    // Old snapshots must not contribute to the latest-date query.
    await insert('spotifyPodcastAggregate', {
        account_id: accountId,
        ...genders,
        spa_gender_female: 900,
        spa_date: '2020-01-01',
        spa_facet: 'old',
        spa_facet_type: 'age',
    })
    await insert('spotifyEpisodeMetadata', {
        account_id: accountId,
        episode_id: 'same-id',
        ep_name: 'Same synthetic title',
    })
    await insert('appleEpisodeMetadata', {
        account_id: accountId,
        episode_id: 11,
        ep_name: 'Same synthetic title',
        ep_collection_name: 'Synthetic',
        ep_release_datetime: '2020-01-01',
        ep_release_date: '2020-01-01',
        ep_guid: `synthetic-guid-${accountId}`,
        ep_type: 'full',
    })
    await insert('spotifyEpisodePerformance', {
        account_id: accountId,
        episode_id: 'same-id',
        spp_percentile_25: 10 * factor,
        spp_percentile_50: 20 * factor,
        spp_percentile_75: 30 * factor,
        spp_percentile_100: 40 * factor,
        spp_sample_max: 100 * factor,
        spp_samples: '[]',
    })
    await insert('appleEpisodeDetails', {
        account_id: accountId,
        episode_id: 11,
        aed_playscount: 1,
        aed_totaltimelistened: 1,
        aed_uniqueengagedlistenerscount: 1,
        aed_uniquelistenerscount: 1,
        aed_engagedplayscount: 1,
        aed_histogram_max_listeners: 100 * factor,
        aed_quarter1_median_listeners: 10 * factor * factor,
        aed_quarter2_median_listeners: 20 * factor * factor,
        aed_quarter3_median_listeners: 30 * factor * factor,
        aed_quarter4_median_listeners: 40 * factor * factor,
    })
    await insert('updates', {
        account_id: accountId,
        endpoint: 'synthetic-endpoint',
        created: `${date} 00:00:00`,
        update_data: '{}',
    })
}

beforeAll(async () => {
    if (!process.env.TEST_MYSQL_URL)
        throw new Error(
            'TEST_MYSQL_URL must point to a disposable MySQL server'
        )
    admin = await mysql.createConnection(process.env.TEST_MYSQL_URL)
    await admin.query(`CREATE DATABASE ${mysql.escapeId(database)}`)
    const uri = new URL(process.env.TEST_MYSQL_URL)
    uri.pathname = `/${database}`
    pool = mysql.createPool(uri.toString())
    const schema = fs.readFileSync('db_schema/schema.sql', 'utf8')
    for (const table of requiredTables) {
        const sql = schema.match(
            new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]+?;`)
        )[0]
        await pool.query(sql)
    }
    await pool.query(schema.match(/CREATE TABLE updates \([\s\S]+?;/)[0])
    api = new AnalyticsApi(new AnalyticsRepository(pool, queries))
    status = new StatusRepository(pool)
    await seed(1, '2026-01-01', 1)
    await seed(2, '2026-02-01', 2)
}, 30000)
afterAll(async () => {
    if (pool) await pool.end()
    if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(database)}`)
        await admin.end()
    }
})
function numbers(rows) {
    return rows.map((row) =>
        Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
                key,
                typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)
                    ? Number(value)
                    : value,
            ])
        )
    )
}
test('all shipped query names are covered', () => {
    expect([...queries.keys()].sort()).toEqual([
        'v1/episodesAge',
        'v1/episodesGender',
        'v1/episodesLTR',
        'v1/ping',
        'v1/podcastAge',
        'v1/podcastGender',
    ])
})
test.each([1, 2])(
    'every shipped analytics query isolates account %i',
    async (accountId) => {
        const factor = accountId
        const guid = `synthetic-guid-${accountId}`
        expect(await api.getAnalytics(accountId, 'v1/ping')).toEqual([
            { result: 'Pong' },
        ])
        expect(
            numbers(await api.getAnalytics(accountId, 'v1/episodesAge'))
        ).toEqual([
            { guid, age_group: '18-24', listeners: 10 * factor, percent: 50 },
        ])
        expect(
            numbers(await api.getAnalytics(accountId, 'v1/podcastAge'))
        ).toEqual([
            { age_group: '18-24', listeners: 10 * factor, percent: 100 },
        ])
        const genderRows = [
            ['female', 2],
            ['male', 3],
            ['non-binary', 1],
            ['not-specified', 4],
        ].map(([gender, n]) => ({
            gender,
            listeners: n * factor,
            age_group: '18-24',
        }))
        expect(
            numbers(await api.getAnalytics(accountId, 'v1/podcastGender'))
        ).toEqual(expect.arrayContaining(genderRows))
        expect(
            (await api.getAnalytics(accountId, 'v1/podcastGender')).length
        ).toBe(4)
        expect(
            numbers(await api.getAnalytics(accountId, 'v1/episodesGender'))
        ).toEqual(
            expect.arrayContaining(genderRows.map((row) => ({ guid, ...row })))
        )
        expect(
            (await api.getAnalytics(accountId, 'v1/episodesGender')).length
        ).toBe(4)
        const quarters = Object.fromEntries(
            [1, 2, 3, 4].flatMap((n) => [
                [`quarter${n}_combined`, n * 10 * factor],
                [`spotify_quarter${n}`, n * 10 * factor],
                [`apple_quarter${n}`, n * 10 * factor],
            ])
        )
        expect(
            numbers(await api.getAnalytics(accountId, 'v1/episodesLTR'))
        ).toEqual([
            {
                name: 'Same synthetic title',
                guid,
                ...quarters,
                listeners_combined: 200 * factor,
                apple_listeners: 100 * factor,
                spotify_listeners: 100 * factor,
            },
        ])
        expect(Object.keys(await status.getStatus(accountId))).toEqual([
            String(accountId),
        ])
    }
)
test('empty tenant cannot see foreign analytics or status', async () => {
    for (const endpoint of queries.keys()) {
        if (endpoint !== 'v1/ping')
            expect(await api.getAnalytics(3, endpoint)).toEqual([])
    }
    expect(await status.getStatus(3)).toEqual({})
})
