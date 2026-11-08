// @ts-check

import { eventSource, event_types } from '../../../../scripts/events.js';
import { t } from '../../../../scripts/i18n.js';

/** @type {boolean} */
let installed = false;

/**
 * @returns {JQueryStatic}
 */
function mustGetJQuery() {
    const root = /** @type {any} */ (globalThis);
    const jq = root.jQuery ?? root.$;
    if (typeof jq !== 'function') {
        throw new Error('WorldInfoGlobalSelectorSelect2Enforcer: jQuery not found');
    }
    return /** @type {JQueryStatic} */ (jq);
}

function enforceWorldInfoGlobalSelect2() {
    const $ = mustGetJQuery();
    const select = document.getElementById('world_info');
    if (!(select instanceof HTMLSelectElement)) return;
    const control = $(select);

    if (!select.multiple) return;

    if (typeof $.fn.select2 !== 'function') return;

    if (control.data('select2')) {
        return;
    }

    control.select2({
        width: '100%',
        placeholder: t`No Worlds active. Click here to select.`,
        allowClear: true,
        closeOnSelect: false,
    });
}

export function installWorldInfoGlobalSelectorSelect2Enforcer() {
    if (installed) {
        return;
    }
    installed = true;

    eventSource.on(event_types.APP_READY, enforceWorldInfoGlobalSelect2);
}
