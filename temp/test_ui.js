const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' }).catch(() => null);
  
  if (!browser) {
    console.log("Sem browser aberto. Vamos usar o launch com um executável local se possível.");
    // We don't have a reliable chromium path here to launch. Let's just fetch the page and parse it? No, need JS execution.
    return;
  }
  
  const pages = await browser.pages();
  const page = pages[0];
  
  // Captura erros no console
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  await page.goto('http://localhost:3000');
  
  // Espera carregar perfis
  await page.waitForTimeout(2000);
  
  console.log("Clicando no botão de vincular...");
  await page.evaluate(() => {
    const btn = document.querySelector('button[title="Vincular a Bot"]');
    if (btn) btn.click();
    else console.log("Botão não encontrado");
  });
  
  await page.waitForTimeout(1000);
  console.log("Script terminado.");
  await browser.disconnect();
})();
