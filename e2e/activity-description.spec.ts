import { expect, test } from '@playwright/test';
import {
  addSubjectViaUi,
  completeOnboarding,
  daysFromNow,
  register,
  uniqueEmail,
  watch,
} from './helpers';

/** The manual form: an optional description under "Más opciones", saved as written and never required. */

test('the description is optional context under "Más opciones": labelled, with a placeholder, saved trimmed', async ({
  page,
}) => {
  const assertClean = watch(page);
  await register(page, uniqueEmail());
  await completeOnboarding(page);
  await addSubjectViaUi(page, 'Redes');
  await page.goto('/activities');
  await page.getByRole('button', { name: 'Agregar actividad' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Agregar actividad' });

  await dialog.getByLabel('Título').fill('Lectura del capítulo 4');
  await dialog.getByLabel('Fecha').fill(daysFromNow(6));
  const description = dialog.getByLabel('Descripción (opcional)');
  if (!(await description.isVisible())) await dialog.getByText('Más opciones').click();
  await expect(description).toHaveAttribute(
    'placeholder',
    'Añade contexto, instrucciones o algo que quieras recordar…',
  );
  await description.fill('  Subrayar las definiciones y llevar dudas a clase  ');
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();

  const list = (await (await page.request.get('/api/activities')).json()).activities as {
    description: string | null;
  }[];
  expect(list[0]!.description).toBe('Subrayar las definiciones y llevar dudas a clase');

  // Empty is fine: a second activity without it saves with none.
  await page.getByRole('button', { name: 'Agregar actividad' }).first().click();
  await dialog.getByLabel('Título').fill('Sin nota');
  await dialog.getByLabel('Fecha').fill(daysFromNow(7));
  await dialog.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = (await (await page.request.get('/api/activities')).json()).activities as {
    title: string;
    description: string | null;
  }[];
  expect(after.find((a) => a.title === 'Sin nota')!.description).toBeNull();
  assertClean();
});
