import type { Show, Slide } from "../../../types/Show"
import type { Category } from "../../../types/Tabs"

// A narrower exception cannot cancel a bypass enabled for the whole show/category.
export function bypassesOutputTemplate(show?: Show | null, slide?: Slide | null, category?: Category | null): boolean {
    return !!(slide?.settings?.bypassOutputTemplate || show?.settings?.bypassOutputTemplate || category?.bypassOutputTemplate)
}
