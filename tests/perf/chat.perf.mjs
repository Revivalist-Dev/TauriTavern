export default async function chat({ page, measureStreaming }) {
    await page.evaluate(async () => {
        globalThis.__perfStartupPhase = false;
        await (await import('/script.js')).waitForGenerationIdle();
    });
    await page.evaluate(() => window.jQuery('#api_button_openai').triggerHandler('click'));
    await page.focus('#send_textarea');
    const tokens = 'The keeper lifts the lantern and counts the ships.'.split(' ');
    const previousReplyId = await page.evaluate(() => globalThis.__perfReplyId || 0);
    await measureStreaming('chat/send-and-stream',
        async () => {
            await page.keyboard.insertText('Tell me about the reef.');
            await page.keyboard.press('Enter');
            await page.waitForFunction(id => (globalThis.__perfReplyId || 0) > id, previousReplyId);
        },
        tokens.map(token => async () => {
            await page.evaluate(text => globalThis.__perfReply.push(text), `${token} `);
            // Give the streaming frame budget time to paint each token deterministically.
            await page.waitForTimeout(30);
        }),
        async () => {
            await page.evaluate(() => globalThis.__perfReply.end());
            await page.evaluate(async () => (await import('/script.js')).waitForGenerationIdle());
        },
    );
}
