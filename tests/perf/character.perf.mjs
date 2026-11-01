/** Characters: opening a heavy card from the character list, then returning to the startup card. */
async function quiet(page) {
    for (let attempt = 0; attempt < 30; attempt++) {
        const generating = await page.evaluate(() => globalThis.__perfGenerating === true);
        if (generating) await page.evaluate(() => document.getElementById('mes_stop')?.click());
        await page.waitForTimeout(100);
    }
    await page.evaluate(async () => (await import('/script.js')).waitForGenerationIdle());
}

export default async function character({ page, measure, centerOf }) {
    const item = avatar => page.locator(`#rm_print_characters_block .character_select[data-avatar="${avatar}"]`);
    const showList = async () => {
        await page.click('#rm_button_characters');
        await item('Review.png').waitFor();
    };
    await page.click('#rightNavDrawerIcon');
    await showList();
    const ledger = await centerOf(item('Ledger.png'));
    await measure('character/open-heavy-card', async () => {
        await page.mouse.click(ledger.x, ledger.y);
        await page.waitForTimeout(500);
    });
    await quiet(page);
    await showList();
    const review = await centerOf(item('Review.png'));
    await measure('character/open-back', async () => {
        await page.mouse.click(review.x, review.y);
        await page.waitForTimeout(500);
    });
    await quiet(page);
    // Later scenarios start with the drawer closed, as after startup.
    await page.click('#rightNavDrawerIcon');
}
