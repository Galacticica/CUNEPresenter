import type { Show } from "../../../types/Show"
import type { Category } from "../../../types/Tabs"

// Zero is the existing "all lines" value. Show/category exceptions are independent
// of template bypasses and apply to every output displaying this show.
export function getEffectiveOutputLineLimit(show: Show | null | undefined, category: Category | null | undefined, configuredLines = 0): number {
    if (show?.settings?.bypassOutputLineLimit) return 0
    const customLimit = show?.settings?.outputLineLimit
    if (typeof customLimit === "number" && Number.isInteger(customLimit) && customLimit > 0) return customLimit
    if (category?.bypassOutputLineLimit) return 0
    return Number(configuredLines || 0)
}
