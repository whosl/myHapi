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

    const deleteUpload = async (path?: string, r2Key?: string) => {
        if (path) {
            try { await api.deleteUploadFile(sessionId, path) } catch { /* best effort */ }
        }
        if (r2Key) {
            try { await api.deleteR2Upload(sessionId, r2Key) } catch { /* best effort */ }
        }
    }

    return {
        accept: '*/*',

        async *add({ file }): AsyncGenerator<PendingAttachment> {
            const id = randomId()
            const contentType = file.type || 'application/octet-stream'

            yield { id, type: 'file', name: file.name, contentType, file,
                status: { type: 'running', reason: 'uploading', progress: 0 } }

            let path: string | undefined
            let r2Key: string | undefined
            let delivered = false
            try {
                if (cancelledAttachmentIds.has(id)) return
                if (file.size > MAX_UPLOAD_BYTES) {
                    yield { id, type: 'file', name: file.name, contentType, file,
                        status: { type: 'incomplete', reason: 'error' } }
                    return
                }

                // Try R2 presigned upload first; fall back to base64 via hub on any failure.
                try {
                    const presign = await api.presignUpload(sessionId, file.name, contentType)
                    if (presign.success && presign.uploadUrl && presign.key) {
                        r2Key = presign.key
                        if (cancelledAttachmentIds.has(id)) return

                        const uploadResp = await fetch(presign.uploadUrl, {
                            method: 'PUT', body: file,
                            headers: { 'Content-Type': contentType },
                        })
                        if (uploadResp.ok) {
                            if (cancelledAttachmentIds.has(id)) return

                            const confirmed = await api.confirmR2Upload(sessionId, presign.key, file.name, contentType)
                            if (confirmed.success && confirmed.path) {
                                path = confirmed.path
                                r2Key = presign.key
                            }
                        }
                    }
                } catch { /* fall through to base64 */ }

                if (cancelledAttachmentIds.has(id)) return
                if (!path && r2Key) {
                    await deleteUpload(undefined, r2Key)
                    r2Key = undefined
                }

                // Fallback: base64 upload via hub
                if (!path) {
                    const content = await fileToBase64(file)
                    if (cancelledAttachmentIds.has(id)) return

                    yield { id, type: 'file', name: file.name, contentType, file,
                        status: { type: 'running', reason: 'uploading', progress: 50 } }

                    if (cancelledAttachmentIds.has(id)) return
                    const result = await api.uploadFile(sessionId, file.name, content, contentType)
                    if (result.success) path = result.path
                    if (cancelledAttachmentIds.has(id)) return
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

                if (cancelledAttachmentIds.has(id)) return
                delivered = true
                yield {
                    id, type: 'file', name: file.name, contentType, file,
                    status: { type: 'requires-action', reason: 'composer-send' },
                    path, r2Key, previewUrl
                } as PendingUploadAttachment
            } catch {
                if (!cancelledAttachmentIds.has(id)) {
                    yield { id, type: 'file', name: file.name, contentType, file,
                        status: { type: 'incomplete', reason: 'error' } }
                }
            } finally {
                if (!delivered) await deleteUpload(path, r2Key)
                cancelledAttachmentIds.delete(id)
            }
        },

        async remove(attachment: Attachment): Promise<void> {
            cancelledAttachmentIds.add(attachment.id)
            const path = (attachment as PendingUploadAttachment).path
            await deleteUpload(path, (attachment as PendingUploadAttachment).r2Key)
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
