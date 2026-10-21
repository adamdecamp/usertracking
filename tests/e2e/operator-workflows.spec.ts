import {test,expect} from '@playwright/test';
import {createOrganizationStatusPackage,organizationStatusPackageFormat,organizationStatusPackageVersion,type OrganizationStatusPayload} from '../../app/organization-status-package.ts';

const snapshotPayload:OrganizationStatusPayload={
 format:organizationStatusPackageFormat,
 version:organizationStatusPackageVersion,
 generatedAtUtc:'2026-10-16T12:00:00.000Z',
 applicationVersion:'e2e',
 ruleSetVersion:'e2e',
 system:{id:'e2e-system',name:'E2E Information System',type:'Administrative'},
 organization:'GOV',
 users:[{
  id:'e2e-user',last:'Shaw',first:'Vivian',middle:'A',email:'vivian.shaw@example.test',disabled:false,
  roles:['General'],privilegedTypes:[],artifacts:[
   {kind:'SAAR',filename:'Shaw_Vivian_(GOV)_GEN_SAAR_16OCT2026.zip'},
   {kind:'DoD Cyber Cert',filename:'Shaw_Vivian_(GOV)_DoD_Cyber_Cert_16OCT2026.zip'},
  ],exceptions:[],
 }],
};

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

test('opens an integrity-checked organization snapshot as a populated read-only directory',async({page})=>{
 const statusPackage=await createOrganizationStatusPackage(snapshotPayload);
 await page.goto('/');
 await page.locator('input[type="file"][accept*="raptor-status"]').setInputFiles({
  name:'GOV.raptor-status.json',
  mimeType:'application/json',
  buffer:Buffer.from(JSON.stringify(statusPackage)),
 });
 await expect(page.getByRole('dialog',{name:'Choose Your Access'})).toBeHidden();
 await expect(page.getByRole('heading',{name:'E2E Information System — GOV Snapshot'})).toBeVisible();
 await expect(page.getByText('Shaw, Vivian A')).toBeVisible();
 await expect(page.getByText('vivian.shaw@example.test')).toBeVisible();
 await expect(page.getByText('Integrity-verified organization snapshot. Evidence files are not included.')).toBeVisible();
 await expect(page.getByRole('button',{name:'+ Add User'})).toHaveCount(0);

 await page.getByRole('textbox',{name:'Search User Directory'}).fill('no-match');
 await expect(page.getByText('Shaw, Vivian A')).toHaveCount(0);
 await page.getByRole('button',{name:'Reset Filters'}).click();
 await expect(page.getByText('Shaw, Vivian A')).toBeVisible();
});

test('rejects a tampered organization snapshot and keeps the access gate closed',async({page})=>{
 const statusPackage=await createOrganizationStatusPackage(snapshotPayload);
 statusPackage.payload.users[0].email='attacker@example.test';
 await page.goto('/');
 const dialogPromise=page.waitForEvent('dialog');
 await page.locator('input[type="file"][accept*="raptor-status"]').setInputFiles({
  name:'tampered.raptor-status.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(statusPackage)),
 });
 const dialog=await dialogPromise;
 expect(dialog.message()).toMatch(/failed.*integrity check|integrity check.*failed/i);
 await dialog.dismiss();
 await expect(page.getByRole('dialog',{name:'Choose Your Access'})).toBeVisible();
});
