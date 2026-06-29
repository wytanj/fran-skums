import type {
  WorkspaceLocale,
  ProductLocalization,
  ProductIngredient,
  IngredientLocalization,
  TranslationStatus,
} from '~/types'

export function useLocalization() {
  const client = useSupabaseClient()
  const { currentWorkspace } = useWorkspace()

  // ── Workspace Locales ──

  const locales = ref<WorkspaceLocale[]>([])
  const localesLoaded = ref(false)

  async function fetchLocales() {
    if (!currentWorkspace.value) return
    const { data, error } = await client
      .from('workspace_locales')
      .select('*')
      .eq('workspace_id', currentWorkspace.value.id)
      .eq('is_active', true)
      .order('sort_order')
    if (error) console.error('[localization] fetchLocales:', error.message)
    locales.value = (data || []) as WorkspaceLocale[]
    localesLoaded.value = true
  }

  const defaultLocale = computed(() =>
    locales.value.find(l => l.is_default) || locales.value[0]
  )

  const nonDefaultLocales = computed(() =>
    locales.value.filter(l => !l.is_default)
  )

  async function addLocale(localeCode: string, localeName: string) {
    if (!currentWorkspace.value) throw new Error('No workspace selected')
    const { error } = await client.from('workspace_locales').insert({
      workspace_id: currentWorkspace.value.id,
      locale_code: localeCode,
      locale_name: localeName,
      sort_order: locales.value.length,
    })
    if (error) throw error
    await fetchLocales()
  }

  async function removeLocale(id: string) {
    const { error } = await client.from('workspace_locales').delete().eq('id', id)
    if (error) throw error
    await fetchLocales()
  }

  async function setDefaultLocale(id: string) {
    if (!currentWorkspace.value) return
    // Unset all defaults first
    await client
      .from('workspace_locales')
      .update({ is_default: false })
      .eq('workspace_id', currentWorkspace.value.id)
    // Set new default
    await client
      .from('workspace_locales')
      .update({ is_default: true })
      .eq('id', id)
    await fetchLocales()
  }

  // ── Product Localizations ──

  async function fetchProductLocalizations(productId: string): Promise<ProductLocalization[]> {
    const { data, error } = await client
      .from('product_localizations')
      .select('*')
      .eq('product_id', productId)
      .order('locale_code')
    if (error) {
      console.error('[localization] fetchProductLocalizations:', error.message)
      return []
    }
    return (data || []) as ProductLocalization[]
  }

  async function upsertLocalization(
    productId: string,
    localeCode: string,
    fields: Partial<Omit<ProductLocalization, 'id' | 'product_id' | 'locale_code' | 'created_at' | 'updated_at'>>,
  ): Promise<ProductLocalization> {
    const { data, error } = await client
      .from('product_localizations')
      .upsert(
        {
          product_id: productId,
          locale_code: localeCode,
          ...fields,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'product_id,locale_code' },
      )
      .select()
      .single()
    if (error) throw error
    return data as ProductLocalization
  }

  async function deleteLocalization(productId: string, localeCode: string) {
    const { error } = await client
      .from('product_localizations')
      .delete()
      .eq('product_id', productId)
      .eq('locale_code', localeCode)
    if (error) throw error
  }

  async function updateTranslationStatus(
    productId: string,
    localeCode: string,
    status: TranslationStatus,
    reviewedBy?: string,
    reviewNotes?: string,
  ) {
    const updates: any = { translation_status: status, updated_at: new Date().toISOString() }
    if (reviewedBy) updates.reviewed_by = reviewedBy
    if (reviewNotes !== undefined) updates.review_notes = reviewNotes

    const { error } = await client
      .from('product_localizations')
      .update(updates)
      .eq('product_id', productId)
      .eq('locale_code', localeCode)
    if (error) throw error
  }

  // ── Product Ingredients ──

  async function fetchIngredients(productId: string): Promise<ProductIngredient[]> {
    const { data, error } = await client
      .from('product_ingredients')
      .select('*')
      .eq('product_id', productId)
      .order('sort_order')
    if (error) {
      console.error('[localization] fetchIngredients:', error.message)
      return []
    }
    return (data || []) as ProductIngredient[]
  }

  async function upsertIngredient(
    productId: string,
    ingredient: Partial<Omit<ProductIngredient, 'id' | 'product_id' | 'created_at' | 'updated_at'>>,
  ): Promise<ProductIngredient> {
    const { data, error } = await client
      .from('product_ingredients')
      .upsert(
        {
          product_id: productId,
          ...ingredient,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'product_id,inci_name' },
      )
      .select()
      .single()
    if (error) throw error
    return data as ProductIngredient
  }

  async function deleteIngredient(id: string) {
    const { error } = await client.from('product_ingredients').delete().eq('id', id)
    if (error) throw error
  }

  // ── Ingredient Localizations ──

  async function fetchIngredientLocalizations(ingredientIds: string[], localeCode: string): Promise<IngredientLocalization[]> {
    if (ingredientIds.length === 0) return []
    const { data, error } = await client
      .from('ingredient_localizations')
      .select('*')
      .in('ingredient_id', ingredientIds)
      .eq('locale_code', localeCode)
    if (error) {
      console.error('[localization] fetchIngredientLocalizations:', error.message)
      return []
    }
    return (data || []) as IngredientLocalization[]
  }

  async function upsertIngredientLocalization(
    ingredientId: string,
    localeCode: string,
    fields: Partial<Omit<IngredientLocalization, 'id' | 'ingredient_id' | 'locale_code' | 'created_at' | 'updated_at'>>,
  ): Promise<IngredientLocalization> {
    const { data, error } = await client
      .from('ingredient_localizations')
      .upsert(
        {
          ingredient_id: ingredientId,
          locale_code: localeCode,
          ...fields,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'ingredient_id,locale_code' },
      )
      .select()
      .single()
    if (error) throw error
    return data as IngredientLocalization
  }

  // ── AI Translation ──

  async function aiTranslateProduct(
    productId: string,
    targetLocale: string,
    sourceLocale?: string,
  ): Promise<ProductLocalization> {
    const result = await $fetch<ProductLocalization>('/api/localization/translate', {
      method: 'POST',
      body: {
        workspaceId: currentWorkspace.value?.id,
        productId,
        targetLocale,
        sourceLocale: sourceLocale || defaultLocale.value?.locale_code || 'en',
      },
    })
    return result
  }

  async function aiTranslateIngredients(
    productId: string,
    targetLocale: string,
  ): Promise<IngredientLocalization[]> {
    const result = await $fetch<{ localizations: IngredientLocalization[] }>('/api/localization/translate-ingredients', {
      method: 'POST',
      body: {
        workspaceId: currentWorkspace.value?.id,
        productId,
        targetLocale,
      },
    })
    return result.localizations
  }

  return {
    locales,
    localesLoaded,
    defaultLocale,
    nonDefaultLocales,
    fetchLocales,
    addLocale,
    removeLocale,
    setDefaultLocale,

    fetchProductLocalizations,
    upsertLocalization,
    deleteLocalization,
    updateTranslationStatus,

    fetchIngredients,
    upsertIngredient,
    deleteIngredient,

    fetchIngredientLocalizations,
    upsertIngredientLocalization,

    aiTranslateProduct,
    aiTranslateIngredients,
  }
}
