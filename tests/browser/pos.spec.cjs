const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
async function login(page, account) {
  await page.goto('/');
  await page.getByLabel('Логин', { exact: true }).fill(account);
  await page.getByLabel('Пароль', { exact: true }).fill('cafe-e2e-password');
  await page.getByRole('button', { name: 'Войти в систему', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Касса и зал' })).toBeVisible();
}
test('cashier and mobile waiter complete a synchronized shift with catalogue and exports', async ({
  page,
  browser,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'e2e_admin');
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    baseURL: testInfo.project.use.baseURL,
  });
  const mobile = await phone.newPage();
  mobile.on('pageerror', (e) => errors.push(e.message));
  await login(mobile, 'e2e_waiter');
  await expect(
    mobile.getByRole('navigation').getByRole('button', { name: 'Отчёты', exact: true }),
  ).toHaveCount(0);
  await mobile.getByRole('button', { name: /Стол 01/ }).click();
  await mobile.getByRole('button', { name: 'Создать заказ', exact: true }).click();
  await mobile.getByLabel('Количество гостей').fill('2');
  await mobile.getByLabel('Комментарий к заказу').fill('Без сахара');
  await mobile.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await mobile.getByRole('button', { name: /Кофе.*Капучино/ }).click();
  await expect(
    mobile.locator('.dish-card').filter({ hasText: 'Капучино' }).locator('.add-dish'),
  ).toHaveText('1');
  await mobile.locator('.mobile-sections').getByRole('button', { name: /Заказ/ }).click();
  await expect(mobile.locator('.order-line')).toContainText('Капучино');
  await expect(mobile.locator('.waiter-saved')).toBeVisible();
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await mobile.screenshot({ path: testInfo.outputPath('waiter-mobile.png'), fullPage: true });
  await expect(page.getByRole('button', { name: /Стол 01/ })).toContainText('Айдана');
  await page.getByRole('button', { name: /Стол 01/ }).click();
  await expect(page.locator('.order-line')).toContainText('Капучино');
  await expect(page.locator('.order-comment')).toContainText('Без сахара');
  await page.screenshot({ path: testInfo.outputPath('cashier-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: /К оплате/ }).click();
  await page.getByLabel('Получено от гостя, сом').fill('500');
  await expect(page.locator('.payment-change')).toContainText('320');
  await page.getByRole('button', { name: 'Подтвердить оплату', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Квитанция');
  await expect(page.frameLocator('.receipt-preview').getByText('НЕ ФИСКАЛЬНЫЙ ЧЕК')).toBeVisible();
  await page.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(mobile.locator('.closed-note')).toContainText('Оплачен');
  await mobile
    .getByRole('navigation')
    .getByRole('button', { name: 'История', exact: true })
    .click();
  await expect(mobile.locator('tbody tr')).toHaveCount(1);
  await expect(mobile.locator('tbody tr')).toContainText('Айдана');
  await mobile.reload();
  await expect(mobile.getByRole('heading', { name: 'Касса и зал' })).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Меню и зал', exact: true })
    .click();
  await page.getByRole('button', { name: /Категории/ }).click();
  await page.getByRole('button', { name: 'Добавить категорию', exact: true }).click();
  await page.getByLabel('Название категории').fill('Сезонное');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('heading', { name: 'Сезонное' })).toBeVisible();
  await page.locator('.section-tabs').getByRole('button', { name: /Блюда/ }).click();
  await page.getByRole('button', { name: 'Добавить блюдо' }).click();
  await page.getByLabel('Название блюда').fill('Лимонад');
  await page.getByLabel('Цена, сом', { exact: true }).fill('170');
  await page.getByLabel('Категория', { exact: true }).selectOption({ label: 'Сезонное' });
  await page.getByLabel('Показывать в быстром меню').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('switch', { name: 'Доступность Лимонад' })).toBeChecked();
  await page.getByRole('switch', { name: 'Доступность Лимонад' }).click();
  await expect(page.getByRole('switch', { name: 'Доступность Лимонад' })).not.toBeChecked();
  await page.getByRole('switch', { name: 'Доступность Лимонад' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'История', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Скачать CSV' }).click();
  const csv = await download;
  expect(await fs.readFile(await csv.path(), 'utf8')).toContain('Айдана');
  await page.getByRole('navigation').getByRole('button', { name: 'Отчёты', exact: true }).click();
  await expect(page.locator('.metric-card').first()).toContainText('180');
  await page.getByRole('navigation').getByRole('button', { name: 'Смены', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть смену' }).click();
  await page.getByLabel('Фактические наличные, сом').fill('680');
  await page.getByRole('dialog').getByRole('button', { name: 'Подтвердить' }).click();
  await expect(page.getByRole('button', { name: 'Открыть смену', exact: true })).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Настройки', exact: true })
    .click();
  await page.getByRole('button', { name: 'Печать', exact: true }).click();
  await expect(page.locator('tbody')).toContainText('Ручная печать');
  expect(errors).toEqual([]);
  await phone.close();
});
