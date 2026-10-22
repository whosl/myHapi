import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function storage() {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
        throw new Error('R2 storage is not configured')
    }
    return {
        client: new S3Client({
            region: 'auto',
            endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY }
        }),
        bucket: R2_BUCKET_NAME
    }
}

export function isSessionUploadKey(sessionId: string, key: string): boolean {
    return key.startsWith(`uploads/${encodeURIComponent(sessionId)}/`) && !key.split('/').some(part => part === '..' || part === '.')
}

export async function createPresignedUpload(sessionId: string, filename: string, mimeType: string) {
    const { client, bucket } = storage()
    const key = `uploads/${encodeURIComponent(sessionId)}/${randomUUID()}/${encodeURIComponent(filename)}`
    const expiresIn = 900
    const uploadUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mimeType }), { expiresIn })
    return { key, uploadUrl, expiresIn }
}

export async function readUpload(key: string, maxBytes: number): Promise<string> {
    const { client, bucket } = storage()
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!result.Body) throw new Error('Empty R2 response')
    const chunks: Buffer[] = []
    let size = 0
    try {
        for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
            size += chunk.length
            if (size > maxBytes) throw new Error('File too large (max 50MB)')
            chunks.push(Buffer.from(chunk))
        }
    } finally {
        if ('destroy' in result.Body && typeof result.Body.destroy === 'function') result.Body.destroy()
    }
    return Buffer.concat(chunks).toString('base64')
}

export async function deleteUpload(key: string): Promise<void> {
    const { client, bucket } = storage()
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}
