<script lang="ts">
    import { activePopup, popupData, styles } from "../../../stores"
    import T from "../../helpers/T.svelte"
    import InputRow from "../../input/InputRow.svelte"
    import MaterialButton from "../../inputs/MaterialButton.svelte"
    import MaterialNumberInput from "../../inputs/MaterialNumberInput.svelte"
    import MaterialToggleSwitch from "../../inputs/MaterialToggleSwitch.svelte"

    const lines = [0, 1, 2, 3, 4, 5, 6]
    const allowDefault = !!$popupData.allowDefault

    let active = $popupData.active || 0

    function setValue(value: any) {
        if (!$popupData.trigger) return

        $popupData.trigger(value)

        let previousActive = JSON.stringify(active)
        active = value
        if (previousActive !== JSON.stringify(value)) return

        popupData.set({})
        activePopup.set(null)
    }

    let styleId = $popupData.styleId || ""
    let style = $styles[styleId]
    function updateStyle(key: string, value: any) {
        styles.update((a) => {
            a[styleId][key] = value
            return a
        })

        style[key] = value
    }

    let showMore = !!style?.showAsFaded || !!style?.skipVirtualBreaks || active > 6
</script>

<MaterialButton class="popup-options {showMore ? 'active' : ''}" icon="options" iconSize={1.3} title={showMore ? "actions.close" : "create_show.more_options"} on:click={() => (showMore = !showMore)} white />

<div class="grid">
    {#if allowDefault}
        <MaterialButton showOutline={active === -1} isActive={active === -1} on:click={() => setValue(-1)}>
            <div class="lines">
                <span class="line" style="opacity: 0.6;"></span>
            </div>
            <p><T id="show.use_default_line_limit" /></p>
        </MaterialButton>
    {/if}
    {#each lines as line}
        {@const isActive = line === Number(active)}
        <MaterialButton showOutline={isActive} {isActive} on:click={() => setValue(line)}>
            <div class="lines">
                {#each { length: line ? line : 5 } as _}
                    <span class="line" style={line ? "" : "opacity: 0.6;"}></span>
                {/each}
            </div>

            <p>
                {#if line === 0}
                    <T id="settings.all_lines" />
                {:else}
                    {line}
                {/if}
            </p>
        </MaterialButton>
    {/each}
</div>

{#if showMore}
    <MaterialNumberInput style="margin-top: 20px;" label={allowDefault ? "show.custom_line_limit" : "actions.custom_key"} value={active < 0 ? 0 : active} min={0} max={99} on:change={(e) => setValue(e.detail)} />

    {#if styleId}
        <InputRow arrow={style?.showAsFaded}>
            <MaterialToggleSwitch label="edit.show_as_faded" style="width: 100%;" checked={!!style?.showAsFaded} defaultValue={false} on:change={(e) => updateStyle("showAsFaded", e.detail)} />

            <div slot="menu">
                <MaterialNumberInput label="edit.opacity (%)" value={style?.lineOpacity ?? 50} min={0} max={99} on:change={(e) => updateStyle("lineOpacity", e.detail)} />
            </div>
        </InputRow>
    {/if}

    {#if styleId}
        <MaterialToggleSwitch label="edit.skip_virtual_breaks" checked={!!style?.skipVirtualBreaks} defaultValue={false} on:change={(e) => updateStyle("skipVirtualBreaks", e.detail)} />
    {/if}
{/if}

<style>
    .grid {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
    }

    .grid :global(button) {
        font-weight: normal;
        border: 2px solid var(--primary-lighter) !important;

        padding: 0.4em;
        flex-direction: column;
        gap: 5px;
        justify-content: center;
    }

    .lines {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 3px;

        width: 100px;
        aspect-ratio: 16/9;

        /* border: 3px solid black; */
        background: black;
        border-radius: 3px;

        /* padding-left: 0; */
        padding: 8px 4px;
    }

    .lines .line {
        height: 5px;
        width: 100%;

        border-radius: 1px;
        /* border-radius: 10px; */

        background-color: white;
        /* border-radius: 1px; */
    }
</style>
