/** DeepLore — Slash Commands: Vault Management */
import { SlashCommandParser } from '../../../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../../../slash-commands/SlashCommand.js';
import { SlashCommandArgument, ARGUMENT_TYPE } from '../../../../../slash-commands/SlashCommandArgument.js';
import { classifyError } from '../../core/utils.js';
import { vaultIndex, setIndexTimestamp } from '../state.js';
import { buildIndex, clearVaultIndexAndCache } from '../vault/vault.js';
// graph.js (~3140 LOC) is lazy-loaded inline below — only paid for when /dle-graph runs.
import { showBrowsePopup } from './popups.js';
import { notify } from '../toast-dedup.js';
import { tr, trf } from '../strings.js';

export function registerVaultCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'dle-graph',
        aliases: ['dle-g'],
        callback: async () => {
            const { showGraphPopup } = await import('../graph/graph.js');
            await showGraphPopup();
            return '';
        },
        helpString: 'Visualize entry relationships as an interactive force-directed graph.',
        returns: ARGUMENT_TYPE.STRING,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'dle-browse',
        aliases: ['dle-b'],
        callback: async () => {
            await showBrowsePopup();
            return '';
        },
        helpString: 'Open the entry browser — searchable, filterable popup of all indexed entries.',
        returns: ARGUMENT_TYPE.STRING,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'dle-refresh',
        aliases: ['dle-r'],
        callback: async () => {
            // Don't pre-clear vaultIndex — buildIndex replaces it atomically. Pre-clearing
            // would give any concurrent generation zero entries during rebuild.
            try {
                setIndexTimestamp(0);
                await buildIndex();
                const msg = `Indexed ${vaultIndex.length} entries.`;
                toastr.success(msg, 'DeepLore');
                return msg;
            } catch (err) {
                console.warn('[DLE] /dle-refresh failed:', err);
                notify.error(trf('dle_cmd_refresh_error_toast', classifyError(err)), { category: 'vault_connect', copyable: true });
                return '';
            }
        },
        helpString: 'Rebuild the vault index by re-fetching all entries from the vault gateway.',
        returns: ARGUMENT_TYPE.STRING,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'dle-clear',
        callback: async () => {
            // Issue #39: wipe-and-stop. Clears the IndexedDB cache AND the live
            // in-memory index without re-fetching — the intentional override for
            // the BUG-367 empty-preserve guard (emptied vault → /dle-clear →
            // /dle-refresh commits []). See docs/gotchas.md #95.
            const result = await clearVaultIndexAndCache();
            if (!result.ok) {
                if (result.reason === 'idb') {
                    // The in-memory wipe already happened (and stays done — that part is
                    // correct); only the IDB wipe failed, so entries may hydrate back on
                    // the next reload. Never toast success here (gotcha #95).
                    notify.error(tr('dle_cmd_clear_idb_failed_toast'), { category: 'cache_clear_idb' });
                } else {
                    notify.warning(tr('dle_cmd_clear_busy_toast'), { category: 'cache_clear_busy' });
                }
                return '';
            }
            const msg = tr('dle_cmd_cacheinfo_cleared_toast');
            toastr.success(msg, 'DeepLore');
            return msg;
        },
        helpString: 'Clear the vault cache AND the live index without re-fetching (wipe-and-stop). Run /dle-refresh to re-index from the vault gateway.',
        returns: ARGUMENT_TYPE.STRING,
    }));

}

