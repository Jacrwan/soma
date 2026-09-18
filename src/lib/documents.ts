import { supabase } from './supabase';
import { SomaDocument, DocumentType } from '../types';

export const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'syllabus', label: 'Syllabus' },
  { value: 'reading', label: 'Reading' },
  { value: 'guide', label: 'Guide' },
  { value: 'notes', label: 'Notes' },
  { value: 'assignment', label: 'Assignment' },
  { value: 'slides', label: 'Slides' },
  { value: 'other', label: 'Other' },
];

const BUCKET = 'documents';
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024; // 20 MB
export const ACCEPTED_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/html',
];
export const ACCEPT_ATTR = '.pdf,.doc,.docx,.ppt,.pptx,.txt,.html,.htm,.jpg,.jpeg,.png,.webp';

export class DocumentError extends Error {}

async function uid(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new DocumentError('Not signed in.');
  return user.id;
}

function rowToDocument(r: Record<string, unknown>): SomaDocument {
  return {
    id: r.id as string,
    subjectId: (r.subject_id as string | null) ?? null,
    fileName: r.file_name as string,
    storagePath: r.storage_path as string,
    fileType: r.file_type as string,
    sizeBytes: Number(r.size_bytes),
    docType: (r.doc_type as DocumentType | undefined) ?? 'other',
    createdAt: r.created_at as string,
    extractionStatus: (r.extraction_status as SomaDocument['extractionStatus'] | undefined) ?? 'pending',
    extractedText: (r.extracted_text as string | null | undefined) ?? null,
  };
}

// Table missing (migration not run yet) surfaces as a distinct error so the
// UI can show "set this up" guidance instead of a bare failure. PGRST205 is
// PostgREST's "table not in schema cache" code (what you get for a table
// that was never created); "Bucket not found" is Storage's equivalent.
function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'PGRST205') return true;
  const message = err instanceof Error ? err.message : String(err);
  return /could not find the table/i.test(message)
    || /bucket not found/i.test(message);
}

// In-memory cache — lets other parts of the app (the AI system prompt, in
// particular) read the user's documents synchronously without a network
// round trip on every chat message. Not persisted; refreshed by listDocuments().
let _documentsCache: SomaDocument[] = [];
let _documentsOwner:string|null=null;
supabase.auth.onAuthStateChange((_event,session)=>{if(_documentsOwner!==session?.user.id){_documentsCache=[];_documentsOwner=session?.user.id??null;}});
export function getCachedDocuments(): SomaDocument[] {
  return _documentsCache;
}

export const DOCUMENTS_CHANGED_EVENT = 'soma_documents_changed';

export async function listDocuments(): Promise<SomaDocument[]> {
  const id = await uid();
  if(_documentsOwner!==id){_documentsCache=[];_documentsOwner=id;}
  const { data, error } = await supabase
    .from('documents')
    .select('*')
    .eq('user_id', id)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error)) throw new DocumentError('not_set_up');
    throw new DocumentError(error.message);
  }
  const docs = (data ?? []).map(rowToDocument);
  if(_documentsOwner===id)_documentsCache = docs;
  window.dispatchEvent(new Event(DOCUMENTS_CHANGED_EVENT));
  return docs;
}

export async function uploadDocument(file: File, subjectId: string | null, docType: DocumentType): Promise<SomaDocument> {
  if (file.size > MAX_DOCUMENT_BYTES) {
    throw new DocumentError(`"${file.name}" is too large (max 20 MB).`);
  }
  if (!ACCEPTED_DOCUMENT_TYPES.includes(file.type)) {
    throw new DocumentError(`"${file.name}" isn't a supported file type.`);
  }

  const id = await uid();
  const docId = crypto.randomUUID();
  const storagePath = `${id}/${docId}-${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    if (isMissingTableError(uploadError)) throw new DocumentError('not_set_up');
    throw new DocumentError(uploadError.message);
  }

  const { data, error } = await supabase
    .from('documents')
    .insert({
      id: docId,
      user_id: id,
      subject_id: subjectId,
      file_name: file.name,
      storage_path: storagePath,
      file_type: file.type,
      size_bytes: file.size,
      doc_type: docType,
    })
    .select('*')
    .single();

  if (error) {
    // Roll back the uploaded file so we don't leak orphaned storage objects.
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    throw new DocumentError(error.message);
  }

  return rowToDocument(data);
}

export async function updateDocument(
  doc: SomaDocument,
  changes: { subjectId?: string | null; docType?: DocumentType },
): Promise<SomaDocument> {
  const id = await uid();
  const { data, error } = await supabase
    .from('documents')
    .update({
      ...(changes.subjectId !== undefined ? { subject_id: changes.subjectId } : {}),
      ...(changes.docType !== undefined ? { doc_type: changes.docType } : {}),
    })
    .eq('id', doc.id)
    .eq('user_id', id)
    .select('*')
    .single();
  if (error) throw new DocumentError(error.message);
  return rowToDocument(data);
}

export async function deleteDocument(doc: SomaDocument): Promise<void> {
  const id = await uid();
  await supabase.storage.from(BUCKET).remove([doc.storagePath]);
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', doc.id)
    .eq('user_id', id);
  if (error) throw new DocumentError(error.message);
  _documentsCache = _documentsCache.filter(d => d.id !== doc.id);
  window.dispatchEvent(new Event(DOCUMENTS_CHANGED_EVENT));
}

export async function getDocumentUrl(doc: SomaDocument): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storagePath, 60 * 10); // 10 minutes
  if (error) throw new DocumentError(error.message);
  return data.signedUrl;
}

// Kicks off server-side text extraction for a just-uploaded document so the AI
// can read it (deadlines, policies, etc.). Fire-and-forget from the caller's
// point of view — errors are swallowed since the row's extraction_status
// already reflects failure, and the UI polls/refetches to pick it up.
export async function extractDocumentText(doc: SomaDocument): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return;
  try {
    await fetch('/api/extract-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ documentId: doc.id }),
    });
  } catch { /* extraction_status stays 'pending'; retried on next visit */ }
}
