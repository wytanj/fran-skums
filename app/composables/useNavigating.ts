/**
 * Is a navigation to `path` currently in flight?
 * Used to show the destination as active-and-loading before it renders.
 */
export function useNavigating() {
  const target = useState<string | null>('nav-target', () => null)

  const isNavigatingTo = (to: string) => {
    if (!target.value) return false
    const t = target.value.split('?')[0]
    const p = to.split('?')[0]
    if (to.includes('?')) return target.value === to
    return t === p || t.startsWith(`${p}/`)
  }

  return { navTarget: target, isNavigatingTo, isNavigating: computed(() => !!target.value) }
}
