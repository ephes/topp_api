import { AuthError } from '../types/api'
import { NextFunction, Request, RequestHandler, Response } from 'express'

class AuthController {
    private accountsMap: Map<string, number>

    constructor(accountsMap: unknown) {
        if (
            accountsMap === null ||
            typeof accountsMap !== 'object' ||
            Array.isArray(accountsMap) ||
            Object.keys(accountsMap).length === 0
        ) {
            throw new Error('Invalid accounts configuration')
        }
        const entries = Object.entries(accountsMap)
        for (const [token, accountId] of entries) {
            if (
                !token ||
                /\s/.test(token) ||
                !Number.isInteger(accountId) ||
                accountId <= 0 ||
                accountId > 2147483647
            ) {
                throw new Error('Invalid accounts configuration')
            }
        }
        this.accountsMap = new Map(entries)
    }

    /**
     * Returns the account id for the specified auth token
     * @param authToken The auth token to get the account id for (incl. 'Bearer ')
     * @returns The account id
     * @throws AuthError if the token is not valid
     * */
    getAccountId = (authToken: string): number => {
        if (authToken.startsWith('Bearer ') === false) {
            throw new AuthError('Specified token is not valid')
        }

        // remove 'Bearer ' from token to get the actual token
        const token = authToken.substring(7)

        if (this.accountsMap.has(token)) {
            return this.accountsMap.get(token) as number
        } else {
            throw new AuthError('Specified token is not valid')
        }
    }

    getMiddleware = (): RequestHandler => {
        return this.handleRequest.bind(this)
    }

    handleRequest = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<any> => {
        const authToken: string | undefined = Array.isArray(
            req.headers.authorization
        )
            ? req.headers.authorization[0]
            : req.headers.authorization

        if (
            authToken === undefined ||
            authToken.length < 7 ||
            !authToken.startsWith('Bearer ')
        ) {
            const err = new AuthError('Not authorized')
            return next(err)
        }

        try {
            // store the user data in the response object (locals is officially made for this)
            // so we can access this data in the backend when it is stored to the database
            const accountId = await this.getAccountId(authToken)
            res.locals.user = {
                accountId,
            }
        } catch (err) {
            return next(
                new AuthError('Not authorized: Specified token is not valid')
            )
        }

        return next()
    }
}

export { AuthController }
