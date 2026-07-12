export {
  parseDelimitedText,
  parseXlsxBuffer,
  matrixToParseResult,
  makeUniqueHeaders,
  parseDelimitedLine,
  looksLikeAbwMatrix,
  ABW_HEADERS,
  TRAILER_PREFIXES,
} from './parse.mjs'

export {
  FIXED_IMPORT_FIELDS,
  buildAliases,
  autoMapColumn,
  proposeColumnMapping,
} from './map.mjs'

export {
  setNested,
  convertValue,
  classifyBarcode,
  normalizeProductFromRow,
  buildImportJobRow,
  reverseColumnMap,
} from './normalize.mjs'

/** Large-file threshold: force job-centric UI + progress persistence */
export const LARGE_IMPORT_ROW_THRESHOLD = 2000
export const IMPORT_BATCH_SIZE = 100

/**
 * @param {Partial<{
 *   phase: string,
 *   detail: string,
 *   current: number,
 *   total: number,
 *   success: number,
 *   errors: number,
 *   created: number,
 *   updated: number,
 * }>} p
 */
export function buildJobProgress(p = {}) {
  return {
    phase: p.phase || 'Waiting',
    detail: p.detail || '',
    current: p.current || 0,
    total: p.total || 0,
    success: p.success || 0,
    errors: p.errors || 0,
    created: p.created || 0,
    updated: p.updated || 0,
    updated_at: new Date().toISOString(),
  }
}
