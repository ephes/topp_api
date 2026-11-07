import { Pool } from 'mysql2/promise'
import { HttpError } from '../types/api'

// A generic query handler for analytics endpoints.
// The queries are loaded from the filesystem and stored in a map.
// Incoming requests are mapped to the corresponding query and executed.
// Non-existing endpoints will throw an error.
class AnalyticsRepository {
    pool: Pool
    queries: Map<string, string>

    constructor(pool: Pool, queries: Map<string, string>) {
        this.pool = pool
        this.queries = queries
    }

    // Execute a query for an endpoint.
    async execute(accountId: number, endpoint: string): Promise<any> {
        // Look up the query text for the endpoint
        const query = this.queries.get(endpoint)

        if (!query) {
            const error = new HttpError('Not Found')
            error.status = 404
            throw error
        }

        // Execute the query and return the result
        const response = await this.pool.execute(query, [accountId])
        // First element of the response is the result
        return response[0]
    }
}

export { AnalyticsRepository }
