/**
 * Dirty multi-provider catalog import with persistent job status.
 * Uses core/import pipeline for parse / map / normalize.
 */
import {
  parseDelimitedText,
  parseXlsxBuffer,
  proposeColumnMapping,
  normalizeProductFromRow,
  buildImportJobRow,
  reverseColumnMap,
  FIXED_IMPORT_FIELDS,
  LARGE_IMPORT_ROW_THRESHOLD,
  IMPORT_BATCH_SIZE,
  buildJobProgress,
} from '../../core/import/index.mjs'

export type ImportStep = 'upload' | 'map' | 'preview' | 'importing' | 'done'

export interface ImportProgress {
  phase: string
  detail: string
  current: number
  total: number
  success: number
  errors: number
  created: number
  updated: number
}

export function useCatalogImport() {
  const client = useSupabaseClient()
  const { currentWorkspace } = useWorkspace()

  const step = ref<ImportStep>('upload')
  const fileName = ref('')
  const providerHint = ref('generic')
  const csvHeaders = ref<string[]>([])
  const csvRows = ref<Record<string, string>[]>([])
  const columnMappings = ref<Record<string, string>>({})
  const mappingConfidence = ref<Record<string, string>>({})
  const mappingSource = ref('deterministic')
  const importResult = ref<{
    success: number
    errors: number
    created: number
    updated: number
    messages: string[]
    jobId?: string | null
  } | null>(null)
  const importing = ref(false)
  const activeJobId = ref<string | null>(null)
  const jobSnapshot = ref<Record<string, any> | null>(null)
  const importProgress = ref<ImportProgress>({
    phase: 'Waiting',
    detail: '',
    current: 0,
    total: 0,
    success: 0,
    errors: 0,
    created: 0,
    updated: 0,
  })

  let pollTimer: ReturnType<typeof setInterval> | null = null

  const isLargeImport = computed(() => csvRows.value.length >= LARGE_IMPORT_ROW_THRESHOLD)

  const importProgressPercent = computed(() => {
    if (!importProgress.value.total) return 0
    return Math.min(100, Math.round((importProgress.value.current / importProgress.value.total) * 100))
  })

  function setImportProgress(update: Partial<ImportProgress>) {
    importProgress.value = { ...importProgress.value, ...update }
  }

  function stopJobPoll() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  async function refreshJobSnapshot(jobId: string) {
    const { data } = await client
      .from('import_jobs')
      .select('*')
      .eq('id', jobId)
      .maybeSingle()
    if (data) {
      jobSnapshot.value = data
      const prog = (data.import_options as any)?.progress
      if (prog && typeof prog === 'object') {
        setImportProgress({
          phase: prog.phase || importProgress.value.phase,
          detail: prog.detail || '',
          current: prog.current ?? importProgress.value.current,
          total: prog.total ?? data.total_rows ?? importProgress.value.total,
          success: prog.success ?? data.committed_rows ?? importProgress.value.success,
          errors: prog.errors ?? data.error_rows ?? importProgress.value.errors,
          created: prog.created ?? importProgress.value.created,
          updated: prog.updated ?? importProgress.value.updated,
        })
      }
    }
    return data
  }

  function startJobPoll(jobId: string) {
    stopJobPoll()
    pollTimer = setInterval(() => {
      refreshJobSnapshot(jobId).catch(() => {})
    }, 1500)
  }

  async function persistJobProgress(
    jobId: string | null,
    patch: Record<string, any>,
    progress: Partial<ImportProgress>,
  ) {
    if (!jobId) return
    const progressPayload = buildJobProgress({
      ...importProgress.value,
      ...progress,
    })
    setImportProgress(progressPayload)
    await client
      .from('import_jobs')
      .update({
        ...patch,
        import_options: {
          ...(jobSnapshot.value?.import_options || {}),
          progress: progressPayload,
        },
      } as any)
      .eq('id', jobId)
    jobSnapshot.value = {
      ...(jobSnapshot.value || {}),
      ...patch,
      import_options: {
        ...(jobSnapshot.value?.import_options || {}),
        progress: progressPayload,
      },
    }
  }

  function applyParsed(
    headers: string[],
    rows: Record<string, string>[],
    hint: string,
    name: string,
  ) {
    fileName.value = name
    providerHint.value = hint
    csvHeaders.value = headers
    csvRows.value = rows

    const proposal = proposeColumnMapping(headers, {
      providerHint: hint,
      fields: FIXED_IMPORT_FIELDS as any,
    })
    columnMappings.value = proposal.mapping
    mappingConfidence.value = proposal.confidence
    mappingSource.value = proposal.mapping_source
    step.value = 'map'
  }

  async function parseImportFile(file: File) {
    const lower = file.name.toLowerCase()
    try {
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const XLSX = await import('xlsx')
        const buf = await file.arrayBuffer()
        const result = parseXlsxBuffer(buf, XLSX)
        applyParsed(result.headers, result.rows, result.providerHint, file.name)
        return
      }
      const text = await file.text()
      const result = parseDelimitedText(text, {
        delimiter: lower.endsWith('.tsv') ? '\t' : undefined,
      })
      applyParsed(result.headers, result.rows, result.providerHint, file.name)
    } catch (error: any) {
      importResult.value = {
        success: 0,
        errors: 1,
        created: 0,
        updated: 0,
        messages: [`Failed to parse file: ${error?.message || 'Unknown error'}`],
      }
      step.value = 'done'
    }
  }

  function importSourceType() {
    const lower = fileName.value.toLowerCase()
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx'
    if (lower.endsWith('.tsv')) return 'tsv'
    return 'csv'
  }

  async function resolveBrandId(
    name: string,
    cache: Record<string, string>,
  ): Promise<string | null> {
    if (!name.trim() || !currentWorkspace.value) return null
    const key = name.trim().toLowerCase()
    if (cache[key]) return cache[key]

    const { data: existing } = await client
      .from('brands')
      .select('id, name')
      .eq('workspace_id', currentWorkspace.value.id)
      .ilike('name', name.trim())
      .limit(1)

    if (existing?.length) {
      cache[key] = existing[0].id
      return existing[0].id
    }

    const { data: created } = await client
      .from('brands')
      .insert({ workspace_id: currentWorkspace.value.id, name: name.trim() })
      .select('id')
      .single()

    if (!created) return null
    cache[key] = created.id
    return created.id
  }

  async function resolveCategoryId(
    name: string,
    cache: Record<string, string>,
  ): Promise<string | null> {
    if (!name.trim() || !currentWorkspace.value) return null
    const key = name.trim().toLowerCase()
    if (cache[key]) return cache[key]

    const { data: existing } = await client
      .from('categories')
      .select('id, name')
      .eq('workspace_id', currentWorkspace.value.id)
      .ilike('name', name.trim())
      .limit(1)

    if (existing?.length) {
      cache[key] = existing[0].id
      return existing[0].id
    }

    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
    const { data: created } = await client
      .from('categories')
      .insert({ workspace_id: currentWorkspace.value.id, name: name.trim(), slug })
      .select('id')
      .single()

    if (!created) return null
    cache[key] = created.id
    return created.id
  }

  /**
   * Prefetch existing products by SKU for upsert (chunked .in queries).
   */
  async function loadExistingSkuMap(skus: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    if (!currentWorkspace.value || !skus.length) return map
    const unique = [...new Set(skus.filter(Boolean))]
    const chunk = 200
    for (let i = 0; i < unique.length; i += chunk) {
      const slice = unique.slice(i, i + chunk)
      const { data } = await client
        .from('products')
        .select('id, sku')
        .eq('workspace_id', currentWorkspace.value.id)
        .in('sku', slice)
      for (const row of data || []) {
        if (row.sku) map.set(String(row.sku), row.id)
      }
    }
    return map
  }

  function yieldToBrowser() {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  async function runImport(options?: { demoCommit?: boolean; defaultPosEnabled?: boolean }) {
    if (!currentWorkspace.value) return
    const reverse = reverseColumnMap(columnMappings.value)
    if (!reverse.title) return

    const demoCommit = options?.demoCommit !== false
    // Wholesale catalogs (ABW): POS off unless explicitly enabled
    const defaultPos =
      options?.defaultPosEnabled ??
      (providerHint.value === 'abw' ? false : true)

    step.value = 'importing'
    importing.value = true
    activeJobId.value = null
    jobSnapshot.value = null
    setImportProgress({
      phase: 'Preparing import job',
      detail: isLargeImport.value
        ? `Large catalog (${csvRows.value.length.toLocaleString()} rows) — progress is saved on the job`
        : 'Creating import job',
      current: 0,
      total: csvRows.value.length,
      success: 0,
      errors: 0,
      created: 0,
      updated: 0,
    })

    const brandCache: Record<string, string> = {}
    const categoryCache: Record<string, string> = {}

    const [brandsRes, categoriesRes] = await Promise.all([
      client.from('brands').select('id, name').eq('workspace_id', currentWorkspace.value.id),
      client.from('categories').select('id, name').eq('workspace_id', currentWorkspace.value.id),
    ])
    for (const b of brandsRes.data || []) brandCache[b.name.toLowerCase()] = b.id
    for (const c of categoriesRes.data || []) categoryCache[c.name.toLowerCase()] = c.id

    const importOptionsBase = {
      demo_commit: demoCommit,
      default_status: 'active',
      default_pos_enabled: defaultPos,
      provider_hint: providerHint.value,
      upsert_by_sku: true,
      large_import: isLargeImport.value,
      progress: buildJobProgress(importProgress.value),
    }

    const jobBase = {
      workspace_id: currentWorkspace.value.id,
      source_type: importSourceType(),
      source_name: providerHint.value === 'abw' ? 'ABW supplier catalog' : 'Supplier upload',
      file_name: fileName.value,
      file_size_bytes: null as number | null,
      status: 'committing',
      column_mapping: columnMappings.value,
      import_options: importOptionsBase,
      total_rows: csvRows.value.length,
      valid_rows: csvRows.value.length,
      mapping_source: mappingSource.value || 'deterministic',
      inferred_column_mapping: columnMappings.value,
      review_status: demoCommit ? 'approved' : 'needs_review',
    }

    let importJobId: string | null = null
    {
      const { data: createdJob, error: createJobError } = await client
        .from('import_jobs')
        .insert(jobBase as any)
        .select('id')
        .single()

      if (createJobError) {
        const { data: fallbackJob } = await client
          .from('import_jobs')
          .insert({
            workspace_id: jobBase.workspace_id,
            source_type: jobBase.source_type,
            source_name: jobBase.source_name,
            file_name: jobBase.file_name,
            status: 'committing',
            column_mapping: jobBase.column_mapping,
            import_options: importOptionsBase,
            total_rows: jobBase.total_rows,
            valid_rows: jobBase.valid_rows,
          } as any)
          .select('id')
          .single()
        importJobId = fallbackJob?.id || null
      } else {
        importJobId = createdJob?.id || null
      }
    }

    activeJobId.value = importJobId
    if (importJobId) {
      await refreshJobSnapshot(importJobId)
      startJobPoll(importJobId)
    }

    let success = 0
    let errors = 0
    let created = 0
    let updated = 0
    const messages: string[] = []

    // Prefetch SKUs for upsert map (critical for large re-imports)
    setImportProgress({
      phase: 'Scanning existing products',
      detail: 'Building SKU upsert map',
      current: 0,
      total: csvRows.value.length,
    })
    const reverseForSku = reverse
    const skuHeader = reverseForSku.supplier_item || reverseForSku.sku
    const allSkus = skuHeader
      ? csvRows.value.map((r) => String(r[skuHeader] || '').trim()).filter(Boolean)
      : []
    const existingBySku = await loadExistingSkuMap(allSkus)
    if (importJobId) {
      await persistJobProgress(
        importJobId,
        { status: 'committing' },
        {
          phase: 'Staging and committing',
          detail: `Upsert map ready (${existingBySku.size.toLocaleString()} existing SKUs)`,
          current: 0,
          total: csvRows.value.length,
        },
      )
    }

    const stagedRows: Record<string, any>[] = []
    type Pending = {
      rowNumber: number
      product: Record<string, any>
      existingId: string | null
      staged?: Record<string, any>
    }
    const pending: Pending[] = []
    const totalBatches = Math.max(1, Math.ceil(csvRows.value.length / IMPORT_BATCH_SIZE))

    const flush = async () => {
      if (!pending.length) return
      const firstRow = pending[0].rowNumber
      const lastRow = pending[pending.length - 1].rowNumber
      const batchNum = Math.ceil(lastRow / IMPORT_BATCH_SIZE)

      await persistJobProgress(
        importJobId,
        {
          status: 'committing',
          committed_rows: success,
          error_rows: errors,
        },
        {
          phase: `Writing batch ${batchNum} of ${totalBatches}`,
          detail: `Rows ${firstRow}–${lastRow}`,
          current: lastRow,
          success,
          errors,
          created,
          updated,
        },
      )

      // Stage rows (skip raw_data bulk for very large files — keep normalized only)
      if (importJobId && stagedRows.length) {
        const toStage = isLargeImport.value
          ? stagedRows.map((r) => {
              const copy = { ...r }
              // Keep raw slim: only identity keys for large jobs
              const raw = r.raw_data || {}
              copy.raw_data = {
                catalog: raw['Catalog No.'] || raw.sku || null,
                upc: raw.UPC || raw.upc || null,
                name: raw['Product Name'] || raw.title || null,
              }
              return copy
            })
          : stagedRows
        const { error: stageErr } = await client.from('import_job_rows').insert(toStage as any[])
        if (stageErr) messages.push(`Rows ${firstRow}-${lastRow}: staging failed: ${stageErr.message}`)
      }

      const toInsert = pending.filter((p) => !p.existingId).map((p) => p.product)
      const toUpdate = pending.filter((p) => p.existingId)

      if (toInsert.length) {
        const { error } = await client.from('products').insert(toInsert as any[])
        if (!error) {
          success += toInsert.length
          created += toInsert.length
        } else {
          for (const item of pending.filter((p) => !p.existingId)) {
            const { error: rowError } = await client.from('products').insert(item.product as any)
            if (rowError) {
              errors++
              if (messages.length < 50) messages.push(`Row ${item.rowNumber}: ${rowError.message}`)
            } else {
              success++
              created++
            }
          }
        }
      }

      for (const item of toUpdate) {
        const { id: _drop, workspace_id: _ws, ...patch } = item.product
        const { error } = await client
          .from('products')
          .update(patch as any)
          .eq('id', item.existingId!)
        if (error) {
          errors++
          if (messages.length < 50) messages.push(`Row ${item.rowNumber} update: ${error.message}`)
        } else {
          success++
          updated++
        }
      }

      pending.length = 0
      stagedRows.length = 0
      await yieldToBrowser()
    }

    for (let i = 0; i < csvRows.value.length; i++) {
      const row = csvRows.value[i]
      setImportProgress({
        phase: importJobId ? 'Staging and committing' : 'Committing',
        detail: `Row ${i + 1} of ${csvRows.value.length}`,
        current: i,
        success,
        errors,
        created,
        updated,
      })

      let normalized: ReturnType<typeof normalizeProductFromRow>
      try {
        normalized = normalizeProductFromRow(row, i, reverse, {
          workspace_id: currentWorkspace.value.id,
          file_name: fileName.value,
          provider_hint: providerHint.value,
          default_pos_enabled: defaultPos,
          default_status: 'active',
          supplier_source: providerHint.value === 'abw' ? 'ABW' : 'supplier',
        })
      } catch (error: any) {
        errors++
        if (messages.length < 50) messages.push(error.message)
        continue
      }

      if (normalized.brand_name) {
        const brandId = await resolveBrandId(normalized.brand_name, brandCache)
        if (brandId) normalized.product.brand_id = brandId
      }
      if (normalized.category_name) {
        const categoryId = await resolveCategoryId(normalized.category_name, categoryCache)
        if (categoryId) normalized.product.category_id = categoryId
      }

      const sku = normalized.product.sku || normalized.product.product_data?.supplier?.item_id
      const existingId = sku ? existingBySku.get(String(sku)) || null : null
      // Track newly created SKUs so later rows in same file upsert correctly
      if (!existingId && sku) {
        // placeholder until insert returns — re-import same file mid-run uses insert once
      }

      if (importJobId) {
        stagedRows.push(
          buildImportJobRow(importJobId, currentWorkspace.value.id, i + 1, row, normalized),
        )
      }
      pending.push({
        rowNumber: i + 1,
        product: normalized.product,
        existingId,
      })

      if (pending.length >= IMPORT_BATCH_SIZE || i === csvRows.value.length - 1) {
        await flush()
      }

      // Persist progress every batch already; also every 500 rows for large jobs
      if (isLargeImport.value && i > 0 && i % 500 === 0) {
        await persistJobProgress(
          importJobId,
          { committed_rows: success, error_rows: errors },
          {
            phase: 'Import in progress',
            detail: `${i.toLocaleString()} / ${csvRows.value.length.toLocaleString()} rows`,
            current: i,
            success,
            errors,
            created,
            updated,
          },
        )
      }
    }

    if (importJobId) {
      await persistJobProgress(
        importJobId,
        {
          status: 'completed',
          committed_rows: success,
          error_rows: errors,
          approved_row_count: success,
          rejected_row_count: errors,
          committed_at: new Date().toISOString(),
        },
        {
          phase: 'Import complete',
          detail: `${created.toLocaleString()} created, ${updated.toLocaleString()} updated, ${errors.toLocaleString()} errors`,
          current: csvRows.value.length,
          total: csvRows.value.length,
          success,
          errors,
          created,
          updated,
        },
      )
      await refreshJobSnapshot(importJobId)
    }

    stopJobPoll()
    importResult.value = {
      success,
      errors,
      created,
      updated,
      messages,
      jobId: importJobId,
    }
    importing.value = false
    step.value = 'done'
  }

  function resetImport() {
    stopJobPoll()
    step.value = 'upload'
    fileName.value = ''
    providerHint.value = 'generic'
    csvHeaders.value = []
    csvRows.value = []
    columnMappings.value = {}
    mappingConfidence.value = {}
    importResult.value = null
    importing.value = false
    activeJobId.value = null
    jobSnapshot.value = null
    setImportProgress({
      phase: 'Waiting',
      detail: '',
      current: 0,
      total: 0,
      success: 0,
      errors: 0,
      created: 0,
      updated: 0,
    })
  }

  onUnmounted(() => stopJobPoll())

  return {
    step,
    fileName,
    providerHint,
    csvHeaders,
    csvRows,
    columnMappings,
    mappingConfidence,
    mappingSource,
    importResult,
    importing,
    activeJobId,
    jobSnapshot,
    importProgress,
    importProgressPercent,
    isLargeImport,
    LARGE_IMPORT_ROW_THRESHOLD,
    parseImportFile,
    runImport,
    resetImport,
    setImportProgress,
    refreshJobSnapshot,
  }
}
