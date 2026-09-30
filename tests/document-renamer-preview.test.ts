import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const styles=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
const versions=readFileSync(new URL('../app/version.ts',import.meta.url),'utf8');
const launcher=readFileSync(new URL('../portable-launcher/Program.cs',import.meta.url),'utf8');
const operationalPanels=readFileSync(new URL('../app/components/OperationalPanels.tsx',import.meta.url),'utf8');

test('Document Renamer preview reserves a full browser window before asynchronous PDF validation',()=>{
 assert.match(page,/function reservePdfPreviewWindow\(filename:string\)\{const target=window\.open\('about:blank','_blank'\)/);
 assert.match(page,/async function showPreview\(item:RenamerItem\)\{const sequence=\+\+previewSequence\.current,target=reservePdfPreviewWindow\(item\.filename\)/);
 assert.match(page,/target&&openPdfInReservedWindow\(target,url\)/);
 assert.match(page,/async function showCollisionPreview\(item:ScannedEvidence\)[\s\S]*?target=reservePdfPreviewWindow\(item\.filename\)/);
});

test('Document Renamer keeps a full-window in-app fallback when popups are blocked',()=>{
 assert.match(page,/if\(!target\)setPreview\(\{loading:true,filename:item\.filename,path:item\.path\}\)/);
 assert.match(page,/import \{createPortal\} from 'react-dom'/);
 assert.match(page,/className="renamer-preview-overlay" role="dialog" aria-modal="true"/);
 assert.match(page,/createPortal\(<div className="renamer-preview-overlay"/);
 assert.match(page,/src=\{`\$\{preview\.url\}#zoom=page-width`\}/);
 assert.match(styles,/\.renamer-preview-overlay\{position:fixed!important;inset:0!important;z-index:2147483647/);
 assert.match(styles,/\.renamer-preview-dialog\{position:fixed;inset:0;display:flex;flex-direction:column;width:100vw;max-width:none;height:100vh;height:100dvh/);
});

test('Document Renamer preview reports loading failures and exposes full-size access',()=>{
 assert.match(page,/Preview Unavailable:/);
 assert.match(page,/Open Full-Size PDF/);
 assert.match(page,/Download Validated PDF Copy/);
});

test('SAAR form identity is fallback-only in Document Renamer',()=>{
 assert.match(page,/applySaarFormFallback\(parsedAnalysis,form\.identity,form\.organization\)/);
 assert.doesNotMatch(page,/first:identity\?\.first\?\?parsedAnalysis\.first/);
});

test('browser Sync caches unchanged Rework in Daily Sync and revalidates it in Legacy Import',()=>{
 assert.match(page,/reworkEvidence=insideOrganizationRework\(path\),cached=!\(legacyImport&&reworkEvidence\)&&!!previous/);
});

test('Daily Sync normalizes filenames while Legacy Import retains corrected Rework recovery',()=>{
 const normalizable=page.match(/const normalizableByPath=[\s\S]*?const filenameRenames=/)?.[0]??'';
 const saarPreparation=page.match(/saarPreparations=[\s\S]*?formSaarPreparations=/)?.[0]??'';
 assert.ok(normalizable,'Sync normalization wiring was not found.');
 assert.ok(saarPreparation,'SAAR preparation wiring was not found.');
 assert.match(normalizable,/for\(const item of scanResult\.evidence\)/);
 assert.match(normalizable,/legacyImport\|\|!rejected\.unchanged/);
 assert.match(saarPreparation,/legacyImport\?/);
 assert.doesNotMatch(normalizable,/!insideOrganizationRework/);
 assert.doesNotMatch(saarPreparation,/!insideOrganizationRework/);
 assert.match(page,/normalizedSourcePaths\.add\(scanPathKey\(previousPath\)\)/);
 assert.match(page,/promotedSourcePaths\.add\(scanPathKey\(source\)\)/);
 assert.match(page,/if\(!normalizedSourcePaths\.has\(key\)&&!known\.has\(key\)\)scanResult\.rejected\.push\(rejection\)/);
 assert.match(page,/if\(!promotedSourcePaths\.has\(key\)&&!known\.has\(key\)\)scanResult\.rejected\.push\(rejection\)/);
});

test('both Sync modes normalize complete noncanonical ZIP names before routing ambiguous ZIPs to Rework',()=>{
 const invalidZipGate=page.match(/const invalidZipCorrections:[\s\S]*?invalidZipPaths=/)?.[0]??'';
 const normalizable=page.match(/const normalizableByPath=[\s\S]*?const filenameRenames=/)?.[0]??'';
 assert.ok(invalidZipGate,'The invalid ZIP gate was not found.');
 assert.match(invalidZipGate,/zipFilenameNeedsRework\(item\.filename,folderOrganization\)&&!canonicalEvidenceFilename\(item\.filename,folderOrganization\)/);
 assert.ok(normalizable,'The shared PDF and ZIP normalization collection was not found.');
 assert.match(normalizable,/scanResult\.evidence/);
 assert.match(normalizable,/!invalidZipPaths\.has/);
});

test('disabled users do not expose actionable supporting-artifact status',()=>{
 assert.match(page,/const status=u\.disabled\?'':statusFor\(u,k\)/);
 assert.match(page,/const filterStatus=user\.disabled\?'':directoryStatusFor\(user,kind,asOf\)/);
 assert.match(page,/if\(u\.disabled\)return <td key=\{kind\} aria-label=\{`\$\{kind\} status not applicable`\}>—<\/td>/);
});

test('DTA Training is an annual DTA requirement throughout the directory workflow',()=>{
 assert.match(page,/\['DTA Training','DTA Training'\]/);
 assert.match(page,/hasPrivilegedType\(u,'DTA'\)\)out\.push\('DTA Training'\)/);
 assert.match(page,/if\(kind==='SAAR'\)return'Current';const due=new Date\(d\);due\.setUTCFullYear\(due\.getUTCFullYear\(\)\+1\)/);
 assert.match(page,/\['8140 Cert Memo','Privileged User Training Cert','DTA Training'\]/);
});

test('manual and synchronized evidence use organization-prefixed document folders',()=>{
 assert.match(page,/function evidenceStoragePath[\s\S]*?organizationArtifactStorageFolder\(kind,user\.organization\)/);
 assert.match(page,/const documentDir=await organizationDir\.getDirectoryHandle\(folder,\{create:true\}\)/);
 assert.match(page,/canonicalFolder=folder&&organizationArtifactStorageFolder\(folder,folderOrganization\)/);
 assert.match(page,/ensureBrowserOrganizationDocumentFolders/);
});

test('browser operational JSON is stored beneath System',()=>{
 assert.match(page,/const browserOperationalFilenames=/);
 assert.match(page,/async function browserOperationalDirectory/);
 assert.match(page,/browserOperationalDirectory\(root\)[\s\S]*?manifestFilename/);
 assert.match(page,/browserOperationalDirectory\(root\)[\s\S]*?syncIndexFilename/);
});

test('incremental Sync uses a validation-only cache version and reports fast-path counts',()=>{
 assert.match(versions,/export const evidenceValidationCacheVersion=/);
 assert.match(page,/readSyncIndex\(JSON\.parse\(text\),evidenceValidationCacheVersion\)/);
 assert.match(page,/createSyncIndex\(evidenceValidationCacheVersion,files\)/);
 assert.match(page,/scan\?rules=\$\{encodeURIComponent\(evidenceValidationCacheVersion\)\}.*&legacy=\$\{legacyImport\?'1':'0'\}/);
 assert.match(page,/\$\{modeLabel\}: \$\{scanResult\.scanned\} discovered in \$\{scopeLabel\}; \$\{scanResult\.unchanged\}/);
 assert.match(page,/Daily retention already completed;/);
});

test('location refresh and discovery workflows use metadata without reopening every PDF',()=>{
 assert.match(page,/portableRequest\(root,`locations\$\{organization\?/);
 assert.match(page,/Refreshing Current Evidence Locations[\s\S]*?refreshEvidenceLocations\(pendingSync\.handle/);
 assert.match(page,/Refreshing Stale Evidence References[\s\S]*?refreshEvidenceLocations\(pendingSync\.handle/);
 assert.match(page,/async function discoverRenamerPdfs[\s\S]*?refreshEvidenceLocations\(root\)/);
 assert.match(page,/async function openReconciliation[\s\S]*?refreshEvidenceLocations\(root/);
 assert.doesNotMatch(page,/Refreshing Current Evidence Locations[\s\S]{0,500}?scan\(pendingSync\.handle/);
 assert.doesNotMatch(page,/Refreshing Stale Evidence References[\s\S]{0,500}?scan\(pendingSync\.handle/);
});

test('Document Renamer automatically applies unique high-confidence names and verifies by metadata only',()=>{
 assert.match(page,/automatic\?item\.confidence==='High':item\.selected/);
 assert.match(page,/const automatic=await renameBatch\(next,true\),verification=await discoverRenamerPdfs/);
 assert.match(page,/reconcileMetadata\(automatic\.remaining,verification\)/);
 assert.match(page,/Unique high-confidence results are renamed automatically/);
 assert.match(page,/Needs Operator Input/);
 assert.match(page,/Archive Trees Excluded/);
 assert.match(styles,/\.renamer-stats\{/);
});

test('Sync applies the shared Document Renamer analysis to changed noncanonical PDFs',()=>{
 const shared=page.match(/async function analyzeRenamerPdf[\s\S]*?function DocumentRenamerModal/)?.[0]??'';
 const sync=page.match(/const syncRenamerCandidates=[\s\S]*?const saarReads=/)?.[0]??'';
 const manual=page.match(/const batch=remaining\.slice[\s\S]*?saveRenamerQueue/)?.[0]??'';
 assert.ok(shared,'The shared Document Renamer PDF analysis routine was not found.');
 assert.ok(sync,'The Sync Document Renamer stage was not found.');
 assert.match(sync,/shouldReadPdfForFilenameNormalization\(syncMode,item\.unchanged\)/);
 assert.match(sync,/documentNeedsFilenameNormalization/);
 assert.match(sync,/!insideArchiveTree\(item\.path\)/);
 assert.doesNotMatch(sync,/!item\.unchanged\|\|insideOrganizationRework\(item\.path\)/);
 assert.match(sync,/analyzeRenamerPdf\(candidate,sourceUsers,h\.name,controller\.signal\)/);
 assert.match(sync,/item\.confidence==='High'/);
 assert.match(sync,/normalizationFailures\.push/);
 assert.match(sync,/renamedDuringSync\+\+/);
 assert.match(manual,/analyzeRenamerPdf\(candidate,users,root\.name\)/);
});

test('the manual Document Renamer button is removed while both Sync modes retain automatic normalization',()=>{
 const toolbar=page.slice(page.indexOf('<section className="toolbar">'),page.indexOf('</section>',page.indexOf('<section className="toolbar">')));
 assert.doesNotMatch(toolbar,/Document Renamer/);
 assert.doesNotMatch(toolbar,/setModal\('renamer'\)/);
 assert.match(page,/Sync Document Renamer/);
 assert.match(page,/Applying Document Renamer Rules/);
});

test('Reconciliation provides a PDF correction report and the redundant Audit Evidence workflow is absent',()=>{
 assert.match(page,/async function generateReconciliationReport/);
 assert.match(operationalPanels,/Generate PDF Report/);
 assert.doesNotMatch(page,/>Audit Evidence</);
 assert.doesNotMatch(page,/function EvidenceAuditModal/);
});

test('paperwork draft preparation is recorded in the User Record and cleared by updates',()=>{
 assert.match(page,/onRecordNotices\(batch\.notices\.map\(notice=>notice\.user\.id\),state,selectedKind,index\+1,batches\.length\)/);
 assert.match(page,/Paperwork Notification History/);
 assert.match(page,/notificationHistory=\(draft\.changes\?\?\[\]\)\.filter\(isComplianceNotificationChange\)/);
 assert.match(page,/u=clearComplianceNotificationHistory\(u\)/);
});

test('User Agreement notification templates are launcher-attached and excluded from Sync',()=>{
 assert.match(page,/getDirectoryHandle\('Template',\{create:true\}\)/);
 assert.match(page,/\['system','template','error reports'/);
 assert.match(page,/notificationUsesUserAgreementTemplate\(state,selectedKind\)/);
 assert.match(page,/portableRequest\(draftRoot,'outlook-draft'/);
 assert.match(page,/attachUserAgreementTemplate:attachAgreementTemplate/);
 assert.match(page,/auditSystemIds:systemIds/);
 assert.match(page,/disabled=\{draftBusyIndex!==null\}/);
 assert.match(page,/Each system receives its own draft with Template\//);
 assert.match(launcher,/outlookThread\.SetApartmentState\(ApartmentState\.STA\)/);
 assert.match(launcher,/Interlocked\.CompareExchange\(ref outlookDraftActive/);
 assert.match(launcher,/templateLookup\.Wait\(TimeSpan\.FromSeconds\(20\)\)/);
 assert.match(launcher,/OutlookHtmlWithSignature\(htmlBody, signatureHtml\)/);
 assert.match(launcher,/OUTLOOK DRAFT DISPLAYED/);
 assert.match(launcher,/OUTLOOK DRAFT FAILED/);
 assert.match(launcher,/background-color:#fff200/);
 assert.match(launcher,/cyber-awareness-challenge/);
 assert.match(launcher,/cdse\.edu\/Training\/eLearning\/DS-IA112/);
});
