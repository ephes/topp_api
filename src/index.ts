import { EventsApi, ConnectorApi } from './api'
import { EventRepository } from './db/EventRepository'
import { SpotifyRepository } from './db/SpotifyRepository'
import { AuthController } from './auth/AuthController'
import { SpotifyConnector } from './api/connectors/SpotifyConnector'
import { AppleRepository } from './db/AppleRepository'
import { AppleConnector } from './api/connectors/AppleConnector'
import { mysqlHealthy } from './healthcheck'
import mysql from 'mysql2/promise'
import { FeedbackRepository } from './db/FeedbackRepository'
import { FeedbackApi } from './api/FeedbackApi'
import { StatusRepository } from './db/StatusRepository'
import { StatusApi } from './api/StatusApi'
import { Config } from './config'
import { DBInitializer } from './db/DBInitializer'
import { QueryLoader } from './db/QueryLoader'
import { AnalyticsRepository } from './db/AnalyticsRepository'
import { AnalyticsApi } from './api/AnalyticsApi'

import { createApp } from './app'

const config = new Config()
const authController = new AuthController(config.getAccountsMap())

const pool = mysql.createPool({
    uri: config.getMySQLConnectionString(),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
})

// checks if tables are there or runs the whole schema.sql script
const dbInit = new DBInitializer(
    pool,
    ['events', 'appleTrendsPodcastFollowers'],
    config.getSchemaData()
)
dbInit.init()

const eventRepo = new EventRepository(pool)
const eventsApi = new EventsApi(eventRepo)

const spotifyRepo = new SpotifyRepository(pool)
const spotifyConnector = new SpotifyConnector(spotifyRepo)

const appleRepo = new AppleRepository(pool)
const appleConnector = new AppleConnector(appleRepo)

const feedbackRepo = new FeedbackRepository(pool)
const feedbackApi = new FeedbackApi(feedbackRepo)

const queryLoader = new QueryLoader(config.getQueryPath())
const queries = queryLoader.loadQueries()

const analyticsRepo = new AnalyticsRepository(pool, queries)
const analyticsApi = new AnalyticsApi(analyticsRepo)

const statusRepo = new StatusRepository(pool)
const statusApi = new StatusApi(statusRepo)

// parameter map will consist of spotify and apple in the future
const connectorApi = new ConnectorApi({
    spotify: spotifyConnector,
    apple: appleConnector,
})

const app = createApp({
    authController,
    eventsApi,
    connectorApi,
    feedbackApi,
    statusApi,
    analyticsApi,
    dbHealthy: mysqlHealthy(pool),
})
const port = config.getExpressPort()

app.listen(port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`)
})
