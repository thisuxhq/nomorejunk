import { Next,Context } from "hono";
import {verify} from 'hono/jwt'


const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'


export const logger = async(c:Context, next:Next) => {
    console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.url}`)
    await next()
}

export const authMiddleware = async(c:Context, next:Next) => {

    try
    {
        const authHeader = c.req.header('Authorization')

        if(!authHeader || !authHeader.startsWith('Bearer '))
        {
            return c.json({
                status: "error",
                message: "Authorization header missing or invalid format" 
            },401)
        }

        const token = authHeader.split(' ')[1]
        const payload = await verify(token,JWT_SECRET)
        const currentTime = Math.floor(Date.now()/1000)
        
        if(payload.exp && payload.exp<currentTime)
        {
            return c.json({
                status: "error",
                message: "Token expired"
            },401)
        }

        c.set('jwtPayload',payload)
        await next()
    }
    catch(error)
    {
        console.error('Auth Error', error)

        if(error instanceof Error)
        {
            switch(true) {
                case error.message.includes('expired'):
                    return c.json({ 
                        status: 'error',
                        message: 'Token expired' 
                    }, 401)
                case error.message.includes('invalid'):
                    return c.json({ 
                        status: 'error',
                        message: 'Invalid token' 
                    }, 401)
                default:
                    return c.json({ 
                        status: 'error',
                        message: 'Authentication failed' 
                    }, 401)
            }  
        }
    }
    
}