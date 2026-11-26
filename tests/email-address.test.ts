import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {isEmailAddress} from '../app/email-address.ts';

// The pattern the page used before; isEmailAddress must accept exactly the same values.
const previous=(value:string)=>value.length<=254&&/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);

test('accepts and rejects the same addresses as the previous pattern',()=>{
 const samples=['jane.doe@example.test','J.Doe+tag@Mail.Example.TEST','a@b.co','a@b..co','a@.b.co','a@b.c','a@b.c0','a@-b.example','a@b.example.','@b.co','a@@b.co','a@b@c.co','a b@c.co','a@b_c.co','a@b.co\n','',`${'a'.repeat(244)}@example.test`,`${'a'.repeat(245)}@example.test`,'x@'+'.'.repeat(200)+'co','x@'+'a.'.repeat(120)+'co'];
 for(const value of samples)assert.equal(isEmailAddress(value),previous(value),JSON.stringify(value));
 // Randomized comparison over the characters that matter.
 const alphabet='aZ09._%+-@.-.a';let seed=7;const next=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648};
 for(let index=0;index<20000;index++){let value='';const length=1+Math.floor(next()*24);for(let position=0;position<length;position++)value+=alphabet[Math.floor(next()*alphabet.length)];assert.equal(isEmailAddress(value),previous(value),JSON.stringify(value))}
});

test('stays fast on long runs of dots that made the previous pattern backtrack',()=>{
 const hostile=`a@${'.'.repeat(250)}`;const started=performance.now();
 for(let index=0;index<2000;index++)isEmailAddress(hostile,100_000);
 assert.ok(performance.now()-started<500);
});

test('the page validates email addresses with the linear check',()=>{
 const helpers=readFileSync(new URL('../app/page-helpers.ts',import.meta.url),'utf8');
 assert.match(helpers,/export const validEmail=\(value:string\)=>isEmailAddress\(value,254\);/);
});
