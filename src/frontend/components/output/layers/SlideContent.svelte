<script lang="ts">
    import { onDestroy, onMount } from "svelte"
    import type { Item, OutSlide, SlideData, TimelineAction } from "../../../../types/Show"
    import { scriptureSettings, showsCache, slideTimelineSpeedMultiplier, templates } from "../../../stores"
    import { waitUntilValueIsDefined } from "../../../utils/common"
    import { shouldItemBeShown } from "../../edit/scripts/itemHelpers"
    import { getItemText } from "../../edit/scripts/textStyle"
    import { clone } from "../../helpers/array"
    import { loadCustomFonts } from "../../helpers/fonts"
    import { getStyleTemplate, itemHasAutoSize, itemNeedsAutoSize, slideHasAutoSizeItem } from "../../helpers/output"
    import Textbox from "../../slide/Textbox.svelte"
    import { SlideTimeline } from "../../timeline/SlideTimeline"
    import SlideItemTransition from "../transitions/SlideItemTransition.svelte"

    export let outputId: string
    export let outSlide: OutSlide
    export let isClearing = false

    export let slideData: SlideData | null
    export let currentSlide: any // Slide | null
    export let currentStyle: any

    export let animationData: any
    export let currentLineId: string | undefined
    export let lines: any

    export let ratio: number
    export let mirror = false
    export let preview = false
    export let transition: any = {}
    export let transitionEnabled = false
    export let styleIdOverride = ""

    let origin = ""
    $: if (outSlide.id) updateShow()
    function updateShow() {
        // custom fonts
        const currentShow = $showsCache[outSlide.id]
        loadCustomFonts(currentShow?.settings?.customFonts || [])
        origin = currentShow?.origin || ""
    }

    // TEST:
    // conditions
    // transitions
    // overlays
    // style lines
    // starting slide while clearing

    let currentItems: Item[] = []
    let current: any = {}
    let show = false

    // Track items that are unchanged between slides and have no transition (to avoid redraw flicker)
    let persistentItems: Item[] = []
    let persistentItemIndexes: number[] = []

    // Check if an item has lines/text content
    function hasLinesContent(item: Item | undefined): boolean {
        if (!item) return false
        return !!getItemText(item).length
    }

    // Compare two items to see if their visible content is identical
    function itemsAreEqual(oldItem: Item | undefined, newItem: Item | undefined): boolean {
        if (!oldItem || !newItem) return false
        // Compare the full serialized content (lines, style, etc.)
        return JSON.stringify(oldItem) === JSON.stringify(newItem)
    }
    // maintain a hidden workload that primes autosize results ahead of the visible reveal
    let precomputeTargets: { item: Item; index: number; key: string; generation: number }[] = []
    let precomputePending = new Set<string>()
    let preparedFontSizes: Record<number, number> = {}

    const showItemRef = { outputId, slideIndex: outSlide?.index }
    let conditionsUpdater = 0
    let isMic = false
    $: isMic = JSON.stringify(currentItems.map((a) => a?.conditions) || "").includes('"element":"volume"')

    let updaterInterval: NodeJS.Timeout
    $: {
        clearInterval(updaterInterval)
        updaterInterval = setInterval(
            () => {
                if (isClearing || !Array.isArray(currentItems)) return
                if (currentItems.find((a) => a?.conditions)) conditionsUpdater++
            },
            isMic ? 100 : 300
        )
    }
    onDestroy(() => clearInterval(updaterInterval))

    // do not update if only line has changed
    $: currentOutSlide = "{}"
    $: if (outSlide) {
        let newOutSlide = clone(outSlide)
        delete newOutSlide.line
        delete newOutSlide.revealCount
        delete newOutSlide.itemClickReveal
        delete newOutSlide.autoAdvance
        let outSlideString = JSON.stringify(newOutSlide)
        if (outSlideString !== currentOutSlide) currentOutSlide = outSlideString
    }
    // do not update if lines has no changes for this output
    $: currentLines = "{}"
    $: if (lines) {
        let outLinesString = JSON.stringify(lines)
        if (outLinesString !== currentLines) currentLines = outLinesString
    }
    // only update if changed (no update when another output changes)
    let currentSlideItems: Item[] | null = null
    $: if (currentSlide?.items !== 0) {
        if (JSON.stringify(currentSlide?.items) !== JSON.stringify(currentSlideItems)) currentSlideItems = clone(currentSlide?.items || null)
    }
    $: if (current && outSlide) {
        if (current.outSlide && current.outSlide.id === outSlide.id && current.outSlide.index === outSlide.index) {
            current.outSlide.itemClickReveal = outSlide.itemClickReveal
            current.outSlide.revealCount = outSlide.revealCount
            current.outSlide.line = outSlide.line
        }
    }
    $: if (current && lines) {
        current.lines = clone(lines)
    }

    $: if (currentSlideItems !== undefined || currentOutSlide || currentLines) updateItems()
    let timeout: NodeJS.Timeout | null = null
    let updateGeneration = 0
    onDestroy(() => {
        updateGeneration++
        if (timeout) clearTimeout(timeout)
        onPrecomputeDone = null
    })

    // if anything is outputted & changing to something that's outputted
    let transitioningBetween = false

    let onPrecomputeDone: (() => void) | null = null

    // kick off hidden textbox renders that warm the autosize cache before we flip "show" on
    function scheduleAutoSizePrecompute(items: Item[]) {
        onPrecomputeDone = null
        preparedFontSizes = {}
        if (preview || !Array.isArray(items) || !items.length) {
            precomputeTargets = []
            precomputePending.clear()
            return
        }

        const targets: typeof precomputeTargets = []
        const pendingKeys = new Set<string>()

        items.forEach((item, index) => {
            if (!itemHasAutoSize(item) || ["media", "camera", "icon"].includes(item.type || "")) return
            const key = createAutoSizeKey(item, index)
            if (!key) return
            pendingKeys.add(key)
            targets.push({ item: clone(item), index, key, generation: updateGeneration })
        })

        precomputeTargets = targets
        precomputePending = pendingKeys
    }

    // remove hidden probes once the underlying textbox reports that its autosize cache is hot
    function handlePrecomputeReady(event: CustomEvent<{ key: string; fontSize: number }>, generation: number) {
        if (generation !== updateGeneration) return
        const key = event.detail?.key
        if (!key || !precomputePending.has(key)) return
        const target = precomputeTargets.find((target) => target.key === key)
        if (target && Number.isFinite(event.detail.fontSize) && event.detail.fontSize > 0) preparedFontSizes[target.index] = event.detail.fontSize
        precomputePending.delete(key)
        if (!precomputePending.size) {
            precomputeTargets = []
            onPrecomputeDone?.()
            onPrecomputeDone = null
        }
    }

    // create a stable identifier for precompute + visible textbox coordination
    function createAutoSizeKey(item: Item, index: number) {
        return item?.id ? String(item.id) : `idx-${index}`
    }

    // outgoing items hold for auto size delay while incoming content calculates font size
    $: incomingNeedsAutoSize = slideNeedsAutoSize(currentSlide, outSlide, currentStyle)
    function slideNeedsAutoSize(slide: any, out: OutSlide, style: any) {
        if (slide?.items?.some(itemNeedsAutoSize)) return true

        let customTemplate = getStyleTemplate(out, style)
        if (!Object.keys(customTemplate).length && out?.id === "temp") customTemplate = $templates[$scriptureSettings.template] || {}

        return slideHasAutoSizeItem(customTemplate)
    }

    let isClearingToEmpty = false
    async function updateItems() {
        const gen = ++updateGeneration
        if (timeout) clearTimeout(timeout)
        let betweenClearingTransition = transition.between || transition
        if (betweenClearingTransition?.type === "none") betweenClearingTransition.duration = 0

        if (!currentSlideItems?.length) {
            scheduleAutoSizePrecompute([])
            currentItems = []
            // Clear persistent items when no slide content
            persistentItems = []
            persistentItemIndexes = []
            current = {
                outSlide: clone(outSlide),
                slideData: clone(slideData),
                currentSlide: clone(currentSlide),
                lines: clone(lines),
                currentStyle: clone(currentStyle)
            }

            // wait for items to properly clear
            // if changing quickly from text to empty to text again, the first text will be displayed again (due to Svelte transition bug)
            if (transitionEnabled) {
                isClearingToEmpty = true
                setTimeout(() => (isClearingToEmpty = false), betweenClearingTransition.duration)
            }
            return
        }

        if (isClearingToEmpty) await waitUntilValueIsDefined(() => !isClearingToEmpty, 10, betweenClearingTransition.duration)
        if (gen !== updateGeneration) return

        scheduleAutoSizePrecompute(currentSlide.items)

        // get any items with no transition between the two slides
        let oldItemTransition = currentItems.find((a) => a.actions?.transition)?.actions?.transition
        let newItemTransition = currentSlide.items.find((a) => a.actions?.transition)?.actions?.transition
        let itemTransitionDuration: number | null = null
        if (oldItemTransition && JSON.stringify(oldItemTransition) === JSON.stringify(newItemTransition)) {
            itemTransitionDuration = oldItemTransition.duration ?? null
            if (oldItemTransition.type === "none") itemTransitionDuration = 0
            // find any item that should have no transition!
            else if (currentSlide.items.find((a) => a.actions?.transition?.duration === 0 || a.actions?.transition?.type === "none")) itemTransitionDuration = 0
        }

        let currentTransition = transition.between || transition.in || transition
        if (currentTransition?.type === "none") currentTransition.duration = 0

        let currentTransitionDuration = transitionEnabled ? (itemTransitionDuration ?? currentTransition?.duration ?? 0) : 0
        let waitToShow = currentTransitionDuration * ((currentTransition?.fadeInOffset ?? 0) / 100)

        // Identify items that are unchanged and have no lines content (to keep outputted without fade)
        const newPersistentIndexes: number[] = []
        const newPersistentItems: Item[] = []
        const transitioningItems: Item[] = []
        const transitioningIndexes: number[] = []

        currentSlide.items.forEach((newItem: Item, newIndex: number) => {
            // Find matching old item by index (position-based matching for slides)
            const oldItem = currentItems[newIndex]

            // Item is persistent if:
            // 1. Content is unchanged AND
            // 2. It does not have lines/text content (non-text items or text items without lines content)
            if (!hasLinesContent(newItem) && itemsAreEqual(oldItem, newItem)) {
                newPersistentIndexes.push(newIndex)
                newPersistentItems.push(clone(newItem))
            } else {
                // Item needs to be re-rendered (changed, or has lines content)
                transitioningIndexes.push(newIndex)
                transitioningItems.push(clone(newItem))
            }
        })

        // Update persistent items (these won't flash)
        persistentItemIndexes = newPersistentIndexes
        persistentItems = newPersistentItems

        // between
        const isDifferentSlide = current.currentSlide?.id !== currentSlide?.id || current.outSlide?.index !== outSlide?.index || current.outSlide?.id !== outSlide?.id
        if (isDifferentSlide && currentItems.length && currentSlide.items.length) transitioningBetween = true

        if (timeout) clearTimeout(timeout)

        // If all items are persistent (unchanged), skip the show/hide cycle entirely
        if (transitioningItems.length === 0 && persistentItems.length > 0) {
            // Just update the context without triggering transitions
            current = {
                outSlide: clone(outSlide),
                slideData: clone(slideData),
                currentSlide: clone(currentSlide),
                lines: clone(lines),
                currentStyle: clone(currentStyle)
            }
            // Keep currentItems in sync but don't toggle show
            currentItems = clone(currentSlide.items || [])
            transitioningBetween = false
            return
        }

        // Keep the outgoing slide fully visible while the incoming font sizes
        // are measured, then start both fades together.
        if (precomputePending.size) {
            await new Promise<void>((resolve) => {
                const safetyTimer = setTimeout(() => {
                    // A failed probe must not leave a slide permanently pending or
                    // introduce a blank frame while the visible textbox retries.
                    if (gen === updateGeneration) {
                        for (const target of precomputeTargets) {
                            if (!preparedFontSizes[target.index]) preparedFontSizes[target.index] = target.item.autoFontSize || 100
                        }
                    }
                    resolve()
                }, 1500)
                onPrecomputeDone = () => {
                    clearTimeout(safetyTimer)
                    resolve()
                }
            })
        }
        if (gen !== updateGeneration) return

        // wait for between to update out transition
        timeout = setTimeout(() => {
            if (gen !== updateGeneration) return
            show = false

            // wait for previous items to start fading out (svelte will keep them until the transition is done!)
            timeout = setTimeout(() => {
                if (gen !== updateGeneration) return
                // Only include items that need transitioning in currentItems
                // Persistent items are rendered separately
                currentItems = clone(currentSlide.items || [])
                current = {
                    outSlide: clone(outSlide),
                    slideData: clone(slideData),
                    currentSlide: clone(currentSlide),
                    lines: clone(lines),
                    currentStyle: clone(currentStyle),
                    preparedFontSizes: clone(preparedFontSizes)
                }

                // Honor an explicitly configured fade-in offset; otherwise crossfade immediately.
                timeout = setTimeout(() => {
                    if (gen !== updateGeneration) return

                    const showSlide = () => {
                        if (gen !== updateGeneration) return
                        show = true

                        // wait for between to set in transition
                        timeout = setTimeout(() => {
                            if (gen !== updateGeneration) return
                            transitioningBetween = false
                        })
                    }

                    showSlide()
                }, waitToShow)
            })
        })
    }

    // OUTPUT SLIDE TIMELINE
    // get current slide timeline position
    let timelinePos = 0
    let timelineItems = new Map<string, Item[]>()
    let timelineActions: TimelineAction[] = []
    let isReady = false
    $: if (outSlide) isReady = false
    $: if (currentSlide) setupTimeline()
    function setupTimeline() {
        if (isReady) return
        timelinePos = 0
        timelineActions = currentSlide?.timeline?.actions || []
        // timelineItems = new Set<Item[]>() // WIP reset eventually?
        setTimeout(() => (isReady = true))
    }
    onMount(() => {
        const interval = setInterval(() => {
            if (isClearing || !isReady || !timelineActions.length) return
            // WIP use actual slide timeline pos when available?
            timelinePos += 15 * $slideTimelineSpeedMultiplier
            styleActions(timelineActions)

            // loop back when reached last action
            if (currentSlide?.timeline?.loop) {
                const lastActionTime = Math.max(...timelineActions.map((a) => a.time + (a.duration || 0) * 1000))
                if (timelinePos >= lastActionTime) timelinePos = 0
            }
        }, 15)

        function styleActions(actions: TimelineAction[]) {
            const itemStyleActions = actions.filter((a) => a.type === "style")
            // group by style key & indexes
            const groupedActions = new Map<string, TimelineAction[]>()
            for (const action of itemStyleActions) {
                const key = action.data?.key
                if (!key) continue

                const indexes = action.data?.indexes ? action.data.indexes.join(",") : ""
                const groupKey = `${key}-${indexes}`

                if (!groupedActions.has(groupKey)) groupedActions.set(groupKey, [])
                groupedActions.get(groupKey)?.push(action)
            }

            const slideKey = `${outSlide?.id}-${outSlide?.layout}-${outSlide?.index}`
            const items = clone(timelineItems.get(slideKey) || currentItems)

            const currentTime = timelinePos
            groupedActions.forEach((actions, _key) => {
                const previous = getPreviousAction(actions)
                const next = getNextAction(actions)
                const value = SlideTimeline.interpolateValue(previous, next, currentTime)
                if (value === null) return

                const action = (previous || next)!
                // const ref = _show(outSlide?.id || "").layouts([outSlide?.layout]).ref()[0] || []
                // const slideId = ref[outSlide?.index || 0]?.id
                // SlideTimeline.triggerAction(action, value, { id: outSlide.id, slideId: slideId })

                const itemIndexes = action.data.indexes ?? [0]
                itemIndexes.forEach((itemIndex) => {
                    const item = items[itemIndex]
                    if (!item) return

                    const updatedItem = SlideTimeline.updateStyle(action, item, value)
                    items[itemIndex] = updatedItem
                })
            })

            timelineItems.set(slideKey, items)
            timelineItems = timelineItems
        }

        function getPreviousAction(actions: TimelineAction[]) {
            const now = timelinePos
            return actions.reduce((prev, curr) => (curr.time > (prev?.time ?? -1) && curr.time <= now ? curr : prev), null as TimelineAction | null)
        }

        function getNextAction(actions: TimelineAction[]) {
            const now = timelinePos
            return actions.reduce((next, curr) => (curr.time > now && (next === null || curr.time < next.time) ? curr : next), null as TimelineAction | null)
        }

        return () => {
            clearInterval(interval)
        }
    })
</script>

<!-- Render all items in original order to maintain z-index layering -->
{#each currentItems as item, index}
    {#if item && shouldItemBeShown(item, [], showItemRef, conditionsUpdater) && (!item.clickReveal || current.outSlide?.itemClickReveal)}
        {#if persistentItemIndexes.includes(index)}
            <!-- Persistent item: unchanged content, render outside transition to avoid flicker -->
            <Textbox
                backdropFilter={current.slideData?.["backdrop-filter"] || ""}
                chords={item.chords?.enabled}
                animationStyle={animationData.style || {}}
                item={timelineItems.get(`${current.outSlide?.id}-${current.outSlide?.layout}-${current.outSlide?.index}`)?.[index] || item}
                transition={null}
                {ratio}
                {outputId}
                ref={{ type: "show", showId: current.outSlide?.id, slideId: current.currentSlide?.id, id: current.currentSlide?.id || "", layoutId: current.outSlide?.layout, origin }}
                linesStart={current.lines?.[currentLineId || ""]?.[item.lineReveal ? "linesStart" : "start"]}
                linesEnd={current.lines?.[currentLineId || ""]?.[item.lineReveal ? "linesEnd" : "end"]}
                clickRevealed={!!current.lines?.[currentLineId || ""]?.clickRevealed}
                outputStyle={current.currentStyle}
                {mirror}
                {preview}
                slideIndex={current.outSlide?.index}
                {styleIdOverride}
                autoSizeKey={createAutoSizeKey(item, index)}
                updateDynamicValues={!isClearing}
            />
        {:else}
            <!-- Transitioning item: render with animation wrapper inside {#key} -->
            {#key show}
                {#if show}
                    <SlideItemTransition precomputed precomputedFontSize={current.preparedFontSizes?.[index]} {preview} {transitionEnabled} {transitioningBetween} {isClearing} {incomingNeedsAutoSize} globalTransition={transition} currentSlide={current.currentSlide} {item} outSlide={current.outSlide} lines={current.lines} currentStyle={current.currentStyle} let:customSlide let:customItem let:customLines let:customOut let:customStyle let:customPreparedFontSize let:transition>
                        <Textbox
                            backdropFilter={current.slideData?.["backdrop-filter"] || ""}
                            chords={customItem.chords?.enabled}
                            animationStyle={animationData.style || {}}
                            item={timelineItems.get(`${customOut?.id}-${customOut?.layout}-${customOut?.index}`)?.[index] || customItem}
                            {transition}
                            {ratio}
                            {outputId}
                            ref={{ type: "show", showId: customOut?.id, slideId: customSlide?.id, id: customSlide?.id || "", layoutId: customOut?.layout, origin }}
                            linesStart={customLines?.[currentLineId || ""]?.[item.lineReveal ? "linesStart" : "start"]}
                            linesEnd={customLines?.[currentLineId || ""]?.[item.lineReveal ? "linesEnd" : "end"]}
                            clickRevealed={!!customLines?.[currentLineId || ""]?.clickRevealed}
                            outputStyle={customStyle}
                            {mirror}
                            {preview}
                            slideIndex={customOut?.index}
                            {styleIdOverride}
                            autoSizeKey={createAutoSizeKey(item, index)}
                            precomputedFontSize={customPreparedFontSize}
                            updateDynamicValues={!isClearing}
                        />
                    </SlideItemTransition>
                {/if}
            {/key}
        {/if}
    {/if}
{/each}

{#if precomputeTargets.length}
    <div class="autosize-precompute" aria-hidden="true">
        {#each precomputeTargets as target (`${target.generation}:${target.key}`)}
            <Textbox
                item={target.item}
                chords={target.item.chords?.enabled}
                {ratio}
                {outputId}
                outputStyle={currentStyle}
                {mirror}
                {preview}
                {styleIdOverride}
                ref={{ type: "show", showId: outSlide?.id, slideId: currentSlide?.id, id: currentSlide?.id || "", layoutId: outSlide?.layout, origin }}
                slideIndex={outSlide?.index}
                linesStart={lines?.[currentLineId || ""]?.[target.item.lineReveal ? "linesStart" : "start"]}
                linesEnd={lines?.[currentLineId || ""]?.[target.item.lineReveal ? "linesEnd" : "end"]}
                clickRevealed={!!lines?.[currentLineId || ""]?.clickRevealed}
                autoSizeKey={target.key}
                on:autosizeReady={(event) => handlePrecomputeReady(event, target.generation)}
                updateDynamicValues={!isClearing}
            />
        {/each}
    </div>
{/if}

<style>
    /* park precompute textboxes far off-screen so they never flash during transitions */
    .autosize-precompute {
        position: absolute;
        top: -10000px;
        left: -10000px;
        width: 100%;
        height: 100%;
        overflow: hidden;
        pointer-events: none;
        visibility: hidden;
    }
</style>
