const html = await (await fetch(new URL('./settings.html', import.meta.url))).text();
document.getElementById('extensions_settings2')?.insertAdjacentHTML('beforeend', html);
