import { Pool, RowDataPacket } from 'mysql2/promise'
import { StatusPayload } from '../types/api'

// This is the type of the object that is returned by the `getStatus` method.
// It is a map where the key is the account ID and the value is an object
// containing the latest update time for each endpoint.
type Status = {
    [key: number]: {
        latestUpdates: {
            [key: string]: Date
        }
    }
}

class StatusRepository {
    pool: Pool

    constructor(pool: Pool) {
        this.pool = pool
    }

    // Return endpoint update times for the authenticated account only.
    async getStatus(accountId: number): Promise<Status> {
        const query = `SELECT account_id, endpoint, MAX(created) AS latest_update FROM updates WHERE account_id = ? GROUP BY account_id, endpoint`
        const response = (await this.pool.query(query, [
            accountId,
        ])) as RowDataPacket[]

        // Response should have at least one row.
        // If not, return an empty object.
        if (response.length === 0) {
            return {}
        }

        const status: Status = {}
        response[0].forEach((row: RowDataPacket) => {
            // Create the account object if it doesn't exist yet
            if (!status[row.account_id]) {
                status[row.account_id] = {
                    latestUpdates: {},
                }
            }

            status[row.account_id].latestUpdates[row.endpoint] = new Date(
                row.latest_update
            )
        })

        return status
    }

    // Write the raw JSON status data into the `updates` table
    // Use the current timestamp as the update time
    async updateStatus(accountId: number, update: StatusPayload): Promise<any> {
        const query = `INSERT INTO updates (account_id, endpoint, update_data) VALUES (?, ?, ?)`
        return await this.pool.query(query, [
            accountId,
            update.endpoint,
            JSON.stringify(update.data),
        ])
    }
}

export { StatusRepository }
