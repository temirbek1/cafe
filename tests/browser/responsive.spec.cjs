const { test, expect } = require('@playwright/test');

const sizes = [
  ['small-phone', 320, 568],
  ['phone', 390, 844],
  ['phone-landscape', 640, 360],
  ['small-tablet', 600, 960],
  ['tablet', 768, 1024],
  ['tablet-landscape', 1024, 768],
  ['short-tablet', 1024, 600],
  ['desktop', 1440, 1000],
];

async function horizontalFit(page) {
  const viewport = page.viewportSize();
  const measured = await page.evaluate(() => {
    const content = document.querySelector('.content');
    return {
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      content: content ? [content.scrollWidth, content.clientWidth] : null,
    };
  });
  // Comparing scrollWidth with innerWidth alone misses mobile auto-shrinking of an oversized page.
  expect(
    measured.viewport,
    'browser must not zoom out to accommodate a desktop layout',
  ).toBeLessThanOrEqual(viewport.width + 1);
  expect(measured.document, 'document must fit the device width').toBeLessThanOrEqual(
    viewport.width + 1,
  );
  if (measured.content)
    expect(
      measured.content[0],
      'page content must fit; wide tables scroll inside their own wrapper',
    ).toBeLessThanOrEqual(measured.content[1] + 1);
}
async function reachable(page, target) {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport({ ratio: 0.99 });
  const box = await target.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  await target.click({ trial: true });
}
async function capture(page, info, name) {
  await horizontalFit(page);
  await page.screenshot({ path: info.outputPath(name + '.png') });
}
async function navigate(page, name) {
  const nav = page.getByRole('navigation', { name: 'Основное меню' });
  const target = nav.getByRole('button', { name, exact: true });
  if (await target.isVisible()) {
    await reachable(page, target);
    await target.click();
  } else {
    await nav.getByRole('button', { name: 'Ещё', exact: true }).click();
    const option = page.getByRole('dialog').getByRole('button', { name, exact: true });
    await reachable(page, option);
    await option.click();
  }
  await expect(page.locator('.content h1')).toBeInViewport();
}
async function modalFits(page, info, name, action = 'Сохранить') {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const width = await dialog.evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(width[0], name + ' must not scroll sideways').toBeLessThanOrEqual(width[1] + 1);
  await capture(page, info, name);
  if (page.viewportSize().width <= 1024) {
    const fonts = await dialog
      .locator('input:not([type=checkbox]),select,textarea')
      .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    expect(
      fonts.every((value) => value >= 16),
      'form fields avoid focus zoom on a phone',
    ).toBe(true);
  }
  await reachable(page, dialog.getByRole('button', { name: action, exact: true }));
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
}
async function login(page, account = 'e2e_admin') {
  await page.goto('/');
  await page.getByLabel('Логин', { exact: true }).fill(account);
  await page.getByLabel('Пароль', { exact: true }).fill('cafe-e2e-password');
  await page.getByRole('button', { name: 'Войти в систему', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Касса и зал', exact: true })).toBeVisible();
}
async function json(page, method, url, data) {
  const response = await page.request.fetch(url, { method, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

for (const [label, width, height] of sizes) {
  test.describe(label, () => {
    test.use({ viewport: { width, height }, isMobile: width < 1000, hasTouch: width <= 1024 });
    test('login and initial setup stay readable and all actions are reachable', async ({
      page,
    }, info) => {
      await page.goto('/');
      await expect(page.getByLabel('Логин', { exact: true })).toBeVisible();
      await capture(page, info, '01-login');
      for (const name of ['Логин', 'Пароль']) {
        const field = page.getByLabel(name, { exact: true });
        await reachable(page, field);
        if (width <= 1024)
          expect(
            await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
          ).toBeGreaterThanOrEqual(16);
      }
      await reachable(page, page.getByRole('button', { name: 'Войти в систему', exact: true }));
      // Render first-run and remote-setup UI without changing the shared test database.
      await page.route('**/auth/status', (route) =>
        route.fulfill({ json: { configured: false, can_setup: true } }),
      );
      await page.reload();
      await expect(page.getByLabel('Имя администратора')).toBeVisible();
      await capture(page, info, '02-first-administrator');
      await reachable(page, page.getByRole('button', { name: 'Создать администратора' }));
      await page.unroute('**/auth/status');
      await page.route('**/auth/status', (route) =>
        route.fulfill({ json: { configured: false, can_setup: false } }),
      );
      await page.reload();
      await expect(
        page.getByText('Первую настройку нужно выполнить', { exact: false }),
      ).toBeVisible();
      await capture(page, info, '03-remote-first-run');
      await reachable(page, page.getByRole('button', { name: 'Проверить снова' }));
    });

    test('admin can use every screen and its forms without clipped navigation', async ({
      page,
    }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await login(page);
      if (width > 950) {
        const sidebar = await page.locator('.sidebar').evaluate((el) => ({
          overflow: getComputedStyle(el).overflowY,
          scroll: el.scrollHeight,
          height: el.clientHeight,
        }));
        if (sidebar.scroll > sidebar.height) expect(sidebar.overflow).toMatch(/auto|scroll/);
      }
      await capture(page, info, '04-floor');
      for (const [name, heading] of [
        ['История', 'История заказов'],
        ['Отчёты', 'Отчёты'],
      ]) {
        await navigate(page, name);
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        await capture(page, info, name === 'История' ? '05-history' : '06-reports');
        await reachable(page, page.getByLabel('Начало периода'));
        await reachable(page, page.getByLabel('Конец периода'));
      }
      await navigate(page, 'Меню и зал');
      await page.getByRole('button', { name: 'Добавить блюдо', exact: true }).click();
      await modalFits(page, info, '07-dish-form');
      await page
        .locator('.section-tabs')
        .getByRole('button', { name: /Категории/ })
        .click();
      await page.getByRole('button', { name: 'Добавить категорию', exact: true }).click();
      await modalFits(page, info, '08-category-form');
      await page.locator('.section-tabs').getByRole('button', { name: /Столы/ }).click();
      await page.getByRole('button', { name: 'Добавить стол', exact: true }).click();
      await modalFits(page, info, '09-table-form');
      await capture(page, info, '10-tables-management');
      await navigate(page, 'Сотрудники');
      await expect(page.getByRole('heading', { name: 'Айбек', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Добавить сотрудника' }).click();
      await modalFits(page, info, '11-employee-form');
      await navigate(page, 'Смены');
      await capture(page, info, '12-shifts');
      await page.getByRole('button', { name: /^(Открыть|Закрыть) смену$/ }).click();
      await modalFits(page, info, '13-shift-form', 'Подтвердить');
      await navigate(page, 'Настройки');
      await capture(page, info, '14-settings');
      await reachable(page, page.getByLabel('Телефон', { exact: true }));
      await reachable(page, page.getByRole('button', { name: 'Сохранить', exact: true }));
      await page
        .locator('.section-tabs')
        .getByRole('button', { name: 'Печать', exact: true })
        .click();
      await capture(page, info, '15-print-settings');
      await reachable(page, page.getByLabel('Ширина ленты'));
      await page
        .locator('.section-tabs')
        .getByRole('button', { name: 'Журнал действий', exact: true })
        .click();
      await capture(page, info, '16-audit');
      await navigate(page, 'Касса');
      await expect(page.getByRole('heading', { name: 'Касса и зал', exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
}

for (const [label, width, height] of [
  ['narrow-phone-checkout', 320, 568],
  ['short-phone-checkout', 390, 360],
  ['short-tablet-checkout', 1024, 600],
]) {
  test.describe(label, () => {
    test.use({ viewport: { width, height }, isMobile: width < 1000, hasTouch: true });
    test('order, split, payment, receipt and refund actions remain reachable in a short window', async ({
      page,
    }, info) => {
      await login(page);
      const currentShift = await json(page, 'GET', '/shifts/current');
      if (!currentShift.shift) await json(page, 'POST', '/shifts/open', { opening_cash: 0 });
      const table = await json(page, 'POST', '/tables', { name: 'Телефон ' + Date.now() });
      const created = await json(page, 'POST', '/orders', {
        table_id: table.id,
        comment: 'Без сахара. Гости на террасе, подать после завтрака.',
      });
      const menu = await json(page, 'GET', '/menu');
      await json(page, 'POST', `/orders/${created.order.id}/items`, {
        menu_item_id: menu[0].id,
        quantity: 2,
      });
      await page.locator('.table-card').filter({ hasText: table.name }).click();
      const mobileSections = page.locator('.mobile-sections');
      if (await mobileSections.isVisible())
        await mobileSections.getByRole('button', { name: 'Меню', exact: true }).click();
      await capture(page, info, '17a-menu');
      const menuWidth = await page
        .locator('.dish-grid')
        .evaluate((el) => [el.scrollWidth, el.clientWidth]);
      expect(menuWidth[0]).toBeLessThanOrEqual(menuWidth[1] + 1);
      if (await mobileSections.isVisible())
        await mobileSections.getByRole('button', { name: /Заказ/ }).click();
      await capture(page, info, '17-order-short-window');
      const orderPane = await page.locator('.order-pane').evaluate((el) => ({
        overflow: getComputedStyle(el).overflowY,
        scroll: el.scrollHeight,
        height: el.clientHeight,
      }));
      if (orderPane.scroll > orderPane.height)
        expect(orderPane.overflow).toMatch(/auto|scroll|visible/);
      await page.getByRole('button', { name: 'Гости и комментарий' }).click();
      await modalFits(page, info, '18-order-details');
      await page.getByRole('button', { name: 'Разделить', exact: true }).click();
      await modalFits(page, info, '19-split');
      await page.getByRole('button', { name: /К оплате/ }).click();
      await capture(page, info, '20-payment');
      await reachable(page, page.getByRole('button', { name: 'Подтвердить оплату', exact: true }));
      await page.getByRole('button', { name: 'Карта', exact: true }).click();
      await page.getByRole('checkbox').check();
      await capture(page, info, '21-card-confirmation');
      await page.getByRole('button', { name: 'Наличные', exact: true }).click();
      await page.getByRole('button', { name: 'Подтвердить оплату', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('Квитанция');
      const receipt = page.frameLocator('.receipt-preview');
      await expect(receipt.getByText('НЕ ФИСКАЛЬНЫЙ ЧЕК')).toBeVisible();
      const receiptWidth = await receipt
        .locator('html')
        .evaluate((el) => [el.scrollWidth, el.clientWidth]);
      expect(
        receiptWidth[0],
        'receipt preview must fit even on a narrow phone',
      ).toBeLessThanOrEqual(receiptWidth[1] + 1);
      await page.emulateMedia({ media: 'print' });
      const printedWidth = await receipt
        .locator('body')
        .evaluate((el) => el.getBoundingClientRect().width);
      expect(
        printedWidth,
        'screen resizing must preserve the 80 mm paper layout with 3 mm margins',
      ).toBeCloseTo((74 * 96) / 25.4, 0);
      await page.emulateMedia({ media: 'screen' });
      await capture(page, info, '22-receipt');
      await reachable(page, page.getByRole('button', { name: 'Готово', exact: true }));
      await page.getByRole('button', { name: 'Готово', exact: true }).click();
      await page.getByRole('button', { name: /Оформить полный возврат/ }).click();
      await capture(page, info, '23-refund');
      await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await json(page, 'POST', `/orders/${created.order.id}/refund`, { reason: 'Тест адаптива' });
    });
  });
}
