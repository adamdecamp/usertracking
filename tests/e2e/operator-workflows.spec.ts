import {test,expect} from '@playwright/test';

test('requires an explicit access choice and opens a read-only session',async({page})=>{
 await page.goto('/');
 const gate=page.getByRole('dialog',{name:'Choose Your Access'});
 await expect(gate).toBeVisible();
 await expect(gate.getByRole('button',{name:'Read-Only Access'})).toBeVisible();
 await expect(gate.getByRole('button',{name:'Full Access'})).toBeVisible();
 await gate.getByRole('button',{name:'Read-Only Access'}).click();
 await expect(gate).toBeHidden();
 await expect(page.getByRole('heading',{name:'R.A.P.T.O.R.'})).toBeVisible();
 await expect(page.getByText('Read-Only Access',{exact:true}).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'+ Add User'})).toHaveCount(0);
});

test('keeps the user guide reachable and branded',async({page})=>{
 await page.goto('/');
 const guide=page.getByRole('link',{name:'Open the User Guide'});
 await expect(guide).toHaveAttribute('href','/user-guide');
 await page.goto('/user-guide');
 await expect(page).toHaveURL(/\/user-guide$/);
 await expect(page.getByRole('heading',{name:'User Guide'})).toBeVisible();
 await expect(page.locator('img[src="/raptor-icon.png"]').first()).toBeVisible();
});

test('access chooser remains keyboard operable',async({page})=>{
 await page.goto('/');
 await page.keyboard.press('Tab');
 const focused=page.locator(':focus');
 await expect(focused).toBeVisible();
 await page.getByRole('button',{name:'Full Access'}).focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog',{name:'Choose Your Access'})).toBeHidden();
 await expect(page.getByText('Full Access',{exact:true}).first()).toBeVisible();
});
