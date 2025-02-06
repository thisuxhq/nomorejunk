import { customAlphabet } from "nanoid";

export function nanoid(length: number = 6):string {
    return customAlphabet('1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',length)()
}