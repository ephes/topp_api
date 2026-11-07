import dotenv from 'dotenv'
import fs from 'fs'

class Config {
    constructor() {
        dotenv.config()
    }

    /*
     * Reads the ACCOUNTS environment variable or the ACCOUNTS_FILE file
     * and returns a map of accounts
     * {
     *  "token": number_of_account
     * }
     * */
    getAccountsMap(): { [key: string]: number } {
        const accounts = this.readStringFromEnvOrFile('ACCOUNTS', '{}')
        try {
            return JSON.parse(accounts || '{}')
        } catch {
            throw new Error('Invalid accounts configuration')
        }
    }

    // reads schema from schema.sql
    getSchemaData(): string {
        const path = './db_schema/schema.sql'
        if (!fs.existsSync(path)) {
            throw new Error(`Schema file not found: ${path}`)
        }
        return fs.readFileSync(path, 'utf8')
    }

    // gets the path to the analytics queries
    // which the query loader will use to load from
    getQueryPath(): string {
        const queryPath = this.readStringFromEnvOrFile(
            'QUERY_PATH',
            './db_schema/queries'
        )
        return queryPath as string
    }

    // reads a value from an environment variable or a file in the format <envVar>_FILE
    readStringFromEnvOrFile(
        envVar: string,
        defaultValue: string | undefined
    ): string | undefined {
        let value = process.env[envVar]
        if (value === undefined) {
            const filePath = process.env[`${envVar}_FILE`]
            if (filePath && fs.existsSync(filePath)) {
                value = fs.readFileSync(filePath, 'utf8')
            }
        }
        if (value === undefined) {
            return defaultValue
        }
        return value
    }

    getPublicOrigin(): string {
        const value = this.readStringFromEnvOrFile('PUBLIC_ORIGIN', '') || ''
        try {
            const url = new URL(value)
            if (
                !['http:', 'https:'].includes(url.protocol) ||
                value !== url.origin
            ) {
                throw new Error()
            }
            return value
        } catch {
            throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin')
        }
    }

    getTrustedProxies(): string[] | false {
        const value = this.readStringFromEnvOrFile('TRUST_PROXY', '') || ''
        return value ? value.split(',').map((entry) => entry.trim()) : false
    }

    getExpressPort(): number {
        const portString = this.readStringFromEnvOrFile('PORT', '8080')
        return parseInt(portString || '8080', 10)
    }

    getMySQLConnectionString(): string | undefined {
        let connectionString = process.env.DB_CONNECTION_STRING
        if (connectionString === undefined) {
            //let's build the connection string from the individual env vars
            const host = this.readStringFromEnvOrFile('MYSQL_HOST', 'localhost')
            const port = this.readStringFromEnvOrFile('MYSQL_PORT', '3306')
            const user = this.readStringFromEnvOrFile('MYSQL_USER', undefined)
            const password = this.readStringFromEnvOrFile(
                'MYSQL_PASSWORD',
                undefined
            )
            const database = this.readStringFromEnvOrFile(
                'MYSQL_DATABASE',
                undefined
            )
            const options = this.readStringFromEnvOrFile('MYSQL_OPTIONS', '')

            if (host && user && password && database && port) {
                connectionString = `mysql://${user}:${password}@${host}:${port}/${database}${options}`
            } else {
                throw new Error(
                    'MySQL connection string not defined or could not be built from environment variables'
                )
            }
        }
        return connectionString
    }
}

export { Config }
