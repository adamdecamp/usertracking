import {test,expect} from '@playwright/test';
import {createOrganizationStatusPackage,organizationStatusPackageFormat,organizationStatusPackageVersion,organizationStatusTrustNote,type OrganizationStatusPayload} from '../../app/organization-status-package.ts';

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
 // A cold Windows or CI launch can spend several seconds starting the local
 // launcher handshake before the access gate closes.
 await expect(gate).toBeHidden({timeout:15_000});
 await expect(page.getByRole('heading',{name:'R.A.P.T.O.R.'})).toBeVisible();
 await expect(page.getByText('Read-Only Access',{exact:true}).first()).toBeVisible();
 await expect(page.getByRole('button',{name:'+ Add User'})).toHaveCount(0);
});

test('opens every dashboard menu without blanking the application',async({page})=>{
 const pageErrors:string[]=[];
 page.on('pageerror',error=>pageErrors.push(error.message));
 await page.goto('/');
 await page.getByRole('dialog',{name:'Choose Your Access'}).getByRole('button',{name:'Read-Only Access'}).click();

 await page.getByText('User Administration',{exact:true}).click();
 await expect(page.getByRole('button',{name:'Archived Systems'})).toBeVisible();

 await page.getByText('Reports & Oversight',{exact:true}).click();
 await expect(page.getByRole('button',{name:'View Audit Log'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Archived Systems'})).toBeHidden();

 // Read-Only still has System Tools for Color Scheme; the removed windows are gone.
 await page.getByText('System Tools',{exact:true}).click();
 await expect(page.getByRole('button',{name:'Color Scheme'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Performance'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Release Health'})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'R.A.P.T.O.R.'})).toBeVisible();
 expect(pageErrors).toEqual([]);
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
 const gate=page.getByRole('dialog',{name:'Choose Your Access'});
 await expect(gate).toBeVisible();
 await expect(gate.getByRole('button',{name:'Read-Only Access'})).toBeFocused();
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
 await expect(page.getByText(organizationStatusTrustNote(false))).toBeVisible();
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
 await page.locator('input[type="file"][accept*="raptor-status"]').setInputFiles({
  name:'tampered.raptor-status.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(statusPackage)),
 });
 const notification=page.getByRole('alert').filter({hasText:'Organization status file could not be opened'});
 await expect(notification).toBeVisible();
 await expect(notification).toContainText(/failed.*integrity check|integrity check.*failed/i);
 await expect(page.getByRole('dialog',{name:'Choose Your Access'})).toBeVisible();
});
test('a color scheme applies at once, closes without a prompt, and is remembered',async({page})=>{
 const dialogs:string[]=[];
 page.on('dialog',dialog=>{dialogs.push(dialog.message());void dialog.dismiss()});
 const brandColor=()=>page.evaluate(()=>document.documentElement.style.getPropertyValue('--rc-277457'));
 await page.goto('/');
 await page.getByRole('dialog',{name:'Choose Your Access'}).getByRole('button',{name:'Read-Only Access'}).click();
 expect(await brandColor()).toBe('');
 await page.getByText('System Tools',{exact:true}).click();
 await page.getByRole('button',{name:'Color Scheme'}).click();
 const schemes=page.getByRole('dialog',{name:'Color Scheme'});
 await schemes.getByRole('radio',{name:/Navy Blue/}).check();
 expect(await brandColor()).not.toBe('');
 await page.keyboard.press('Escape');
 await expect(schemes).toBeHidden();
 expect(dialogs).toEqual([]);
 const chosen=await brandColor();
 await page.reload();
 await page.getByRole('dialog',{name:'Choose Your Access'}).getByRole('button',{name:'Read-Only Access'}).click();
 expect(await brandColor()).toBe(chosen);
 await page.getByText('System Tools',{exact:true}).click();
 await page.getByRole('button',{name:'Color Scheme'}).click();
 await page.getByRole('dialog',{name:'Color Scheme'}).getByRole('button',{name:'Restore Original Colors'}).click();
 expect(await brandColor()).toBe('');
});

test('the compliance trend chart offers 3, 6, 9, and 12 months and reflects an organization status file',async({page})=>{
 const statusPackage=await createOrganizationStatusPackage(snapshotPayload);
 await page.goto('/');
 await page.locator('input[type="file"][accept*="raptor-status"]').setInputFiles({name:'GOV.raptor-status.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(statusPackage))});
 await expect(page.getByRole('dialog',{name:'Choose Your Access'})).toBeHidden();
 const trend=page.getByRole('region',{name:'Compliance Trend'});
 await expect(trend).toBeVisible();
 await expect(trend.getByText(/% Compliant Today$/)).toBeVisible();
 await expect(trend.getByText(/of 1 user\)/)).toBeVisible();
 await expect(trend.getByText(/An Organization Status File holds today.s status only/)).toBeVisible();
 await expect(trend.getByRole('button',{name:'6 Months'})).toHaveAttribute('aria-pressed','true');
 for(const months of [3,9,12]){
  await trend.getByRole('button',{name:`${months} Months`}).click();
  await expect(trend.getByRole('button',{name:`${months} Months`})).toHaveAttribute('aria-pressed','true');
  await expect(trend.getByRole('img')).toHaveAttribute('aria-label',new RegExp(`over the last ${months} months`));
 }
 await trend.getByText('Show the Numbers').click();
 await expect(trend.getByRole('columnheader',{name:'Week Of'})).toBeVisible();
 await page.getByRole('textbox',{name:'Search User Directory'}).fill('no-match');
 await expect(trend.getByText('No Users to Chart')).toBeVisible();
});
