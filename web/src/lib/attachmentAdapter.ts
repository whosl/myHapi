import type { AttachmentAdapter, PendingAttachment, CompleteAttachment, Attachment } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type { AttachmentMetadata } from '@/types/api'
import { isImageMimeType } from '@/lib/fileAttachments'
import { randomId } from '@/lib/randomId'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024

type PendingUploadAttachment = PendingAttachment & {
    path?: string
    r2Key?: string
    previewUrl?: string
}

export function createAttachmentAdapter(api: ApiClient, sessionId: string): AttachmentAdapter {
    const cancelledAttachmentIds = new Set<string>()

    const deleteUpload = async (path?: string) => {
        if (!path) return
        try { await api.deleteUploadFile(sessionId, path) } catch { /* best effort */ }
    }

    return {
        accept: '*/*',

        async *add({ file }): AsyncGenerator<PendingAttachment> {
            const id = randomId()
            const contentType = file.type || 'application/octet-stream'

            yield { id, type: 'file', name: file.name, contentType, file,
                status: { type: 'running', reason: 'uploading', progress: 0 } }

            try {
                if (cancelledAttachmentIds.has(id)) return
                if (file.size > MAX_UPLOAD_BYTES) {
                    yield { id, type: 'file', name: file.name, contentType, file,
                        status: { type: 'incomplete', reason: 'error' } }
                    return
                }

                // Try R2 presigned upload first; fall back to base64 via hub on any failure
                let path: string | undefined
                let r2Key: string | undefined

                try {
                    const presign = await api.presignUpload(sessionId, file.name, contentType)
                    if (presign.success && presign.uploadUrl) {
                        yield { id, type: 'file', name: file.name, contentType, file,
                            status: { type: 'running', reason: 'uploading', progress: 30 } }

                        const uploadResp = await fetch(presign.uploadUrl, {
                            method: 'PUT', body: file,
                            headers: { 'Content-Type': contentType },
                        })
                        if (uploadResp.ok) {
                            yield { id, type: 'file', name: file.name, contentType, file,
                                status: { type: 'running', reason: 'uploading', progress: 80 } }

                            const confirmed = await api.confirmR2Upload(sessionId, presign.key!, file.name, contentType)
                            if (confirmed.success && confirmed.path) {
                                path = confirmed.path
                                r2Key = presign.key!
                            }
                        }
                    }
                } catch { /* fall through to base64 */ }

                // Fallback: base64 upload via hub
                if (!path) {
                    const content = await fileToBase64(file)
                    if (cancelledAttachmentIds.has(id)) return

                    yield { id, type: 'file', name: file.name, contentType, file,
                        status: { type: 'running', reason: 'uploading', progress: 50 } }

                    const result = await api.uploadFile(sessionId, file.name, content, contentType)
                    if (cancelledAttachmentIds.has(id)) {
                        if (result.success && result.path) await deleteUpload(result.path)
                        return
                    }
                    if (!result.success || !result.path) {
                        yield { id, type: 'file', name: file.name, contentType, file,
                            status: { type: 'incomplete', reason: 'error' } }
                        return
                    }
                    path = result.path
                }

                let previewUrl: string | undefined
                if (isImageMimeType(contentType) && file.size <= MAX_PREVIEW_BYTES) {
                    previewUrl = await fileToDataUrl(file)
                }

                yield {
                    id, type: 'file', name: file.name, contentType, file,
                    status: { type: 'requires-action', reason: 'composer-send' },
                    path, r2Key, previewUrl
                } as PendingUploadAttachment
            } catch {
                yield { id, type: 'file', name: file.name, contentType, file,
                    status: { type: 'incomplete', reason: 'error' } }
            }
        },

        async remove(attachment: Attachment): Promise<void> {
            cancelledAttachmentIds.add(attachment.id)
            const path = (attachment as PendingUploadAttachment).path
            await deleteUpload(path)
        },

        async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
            const pending = attachment as PendingUploadAttachment
            const path = pending.path
            const metadata: AttachmentMetadata | undefined = path ? {
                id: attachment.id,
                filename: attachment.name,
                mimeType: attachment.contentType ?? 'application/octet-stream',
                size: attachment.file?.size ?? 0,
                path,
                previewUrl: pending.previewUrl
            } : undefined
            return {
                id: attachment.id, type: attachment.type,
                name: attachment.name, contentType: attachment.contentType,
                status: { type: 'complete' },
                content: metadata ? [{ type: 'text', text: JSON.stringify({ __attachmentMetadata: metadata }) }] : []
            }
        }
    }
}

async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result as string
            const base64 = result.split(',')[1]
            if (!base64) { reject(new Error('Failed to read file')); return }
            resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}
