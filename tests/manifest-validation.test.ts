import test from 'node:test';
import assert from 'node:assert/strict';
import {manifestArtifactPathLimit,validManifestArtifactPath} from '../app/manifest-validation.ts';

test('accepts long Windows-relative provenance paths produced by Sync',()=>{
 const path=`User Evidence/${'nested/'.repeat(200)}Brown_Jacob/certificate.pdf`;
 assert.ok(path.length>1000);
 assert.equal(validManifestArtifactPath(path),true);
});

test('rejects unsafe or unbounded manifest paths',()=>{
 assert.equal(validManifestArtifactPath(`folder\nfile.pdf`),false);
 assert.equal(validManifestArtifactPath(`folder\u0000file.pdf`),false);
 assert.equal(validManifestArtifactPath('x'.repeat(manifestArtifactPathLimit+1)),false);
});
