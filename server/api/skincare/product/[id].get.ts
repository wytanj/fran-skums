import { getServiceClient } from '../../../utils/supabase'

const WORKSPACE_ID = '4fdea5f5-413a-40b8-9b39-9fcad66ebf17'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, message: 'Product ID required' })
  }

  const db = getServiceClient()

  const { data: product, error } = await db
    .from('external_products')
    .select('*')
    .eq('id', id)
    .eq('workspace_id', WORKSPACE_ID)
    .single()

  if (error || !product) {
    throw createError({ statusCode: 404, message: 'Product not found' })
  }

  // Also fetch ingredient safety details for each ingredient
  let ingredientDetails: any[] = []
  if (product.ingredients && product.ingredients.length > 0) {
    const lowerIngredients = product.ingredients.map((i: string) => i.toLowerCase())
    const { data: safetyData } = await db
      .from('ingredient_safety')
      .select('*')

    if (safetyData) {
      ingredientDetails = product.ingredients.map((inci: string) => {
        const safety = safetyData.find(
          (s: any) => s.inci_name.toLowerCase() === inci.toLowerCase()
        )
        return {
          inci_name: inci,
          ...(safety ?? { tier: null, ewg_score: null, function: null, trend: null }),
        }
      })
    }
  }

  // Fetch pairwise conflicts among this product's ingredients
  let pairwiseConflicts: any[] = []
  if (product.ingredients && product.ingredients.length > 1) {
    const { data: conflicts } = await db
      .from('ingredient_pairwise_conflicts')
      .select('*')

    if (conflicts) {
      const lowerIngredients = product.ingredients.map((i: string) => i.toLowerCase())
      pairwiseConflicts = conflicts.filter((c: any) => {
        const a = c.ingredient_a.toLowerCase()
        const b = c.ingredient_b.toLowerCase()
        return lowerIngredients.some(i => i.includes(a) || a.includes(i)) &&
               lowerIngredients.some(i => i.includes(b) || b.includes(i))
      })
    }
  }

  return {
    product,
    ingredient_details: ingredientDetails,
    pairwise_conflicts: pairwiseConflicts,
  }
})
